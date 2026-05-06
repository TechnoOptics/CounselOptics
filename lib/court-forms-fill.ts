import { PDFDocument } from 'pdf-lib';
import { resolveFormValues, getCourtForm } from './court-forms';

/**
 * Stage 2 of the court-form pipeline. Stage 1 (lib/court-forms.ts)
 * defines the registry + resolves dot-paths against case data.
 * Stage 2 (here) downloads the PDF, opens its AcroForm, writes
 * every field map's value, flattens the form (so the values can't
 * be edited later), and returns the filled bytes.
 *
 * Called from /api/firm/court-forms/fill route. The operator picks
 * a form + a case, the route assembles the case data record (parties,
 * jurisdiction, attorney info), and we write a PDF the firm can
 * download or attach to a signing request.
 *
 * Note: not every official court PDF has fillable AcroForm fields.
 * For non-fillable PDFs (scanned originals, image-only forms), the
 * operator gets a clear "this form needs manual fill" error and
 * the registry's pdfUrl link so they can download the source.
 */
export async function fillCourtForm(
  formId: string,
  caseData: Record<string, unknown>,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const form = getCourtForm(formId);
  if (!form) return { ok: false, error: `Unknown form id: ${formId}` };

  let pdfBytes: ArrayBuffer;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    const resp = await fetch(form.pdfUrl, { signal: ctl.signal });
    clearTimeout(t);
    if (!resp.ok) {
      return {
        ok: false,
        error: `Source PDF returned ${resp.status} from ${form.pdfUrl}.`,
      };
    }
    pdfBytes = await resp.arrayBuffer();
  } catch (err) {
    return {
      ok: false,
      error: `Failed to fetch source PDF: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes);
  } catch (err) {
    return {
      ok: false,
      error: `Could not parse the source PDF: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const acroForm = pdfDoc.getForm();
  const values = resolveFormValues(form, caseData);
  const declaredFields = new Set(Object.keys(values));
  const acroFieldNames = new Set(acroForm.getFields().map((f) => f.getName()));

  const writtenFields: string[] = [];
  const missingInPdf: string[] = [];
  for (const fieldName of declaredFields) {
    if (!acroFieldNames.has(fieldName)) {
      missingInPdf.push(fieldName);
      continue;
    }
    const value = values[fieldName];
    if (value === '') continue;
    try {
      // Try as text first, fall back to checkbox / radio for known
      // patterns.
      const field = acroForm.getField(fieldName);
      const fieldType = field.constructor.name;
      if (fieldType === 'PDFTextField') {
        acroForm.getTextField(fieldName).setText(value);
        writtenFields.push(fieldName);
      } else if (fieldType === 'PDFCheckBox') {
        const truthy = ['Yes', 'true', '1', 'On', 'Checked'].includes(value);
        if (truthy) acroForm.getCheckBox(fieldName).check();
        writtenFields.push(fieldName);
      } else if (fieldType === 'PDFRadioGroup') {
        try {
          acroForm.getRadioGroup(fieldName).select(value);
          writtenFields.push(fieldName);
        } catch {
          /* unknown option */
        }
      }
    } catch {
      /* skip unmappable fields */
    }
  }

  // Hard-flatten the form so the filled values can't be edited
  // post-export. Comment this line out if the firm wants a fillable
  // PDF for further client review before flattening.
  acroForm.flatten();

  const out = await pdfDoc.save();

  if (writtenFields.length === 0) {
    return {
      ok: false,
      error:
        missingInPdf.length > 0
          ? 'Source PDF has no fillable AcroForm fields matching the registry. The form may be image-only or use field names different from the registry mapping.'
          : 'No fields written. The case data may be missing every mapped path.',
    };
  }

  return { ok: true, bytes: out };
}
