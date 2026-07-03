/**
 * Spanish-language free templates. Content-only translation of the
 * highest-value English template (the demand letter is the biggest
 * backlink magnet in the English set - the Spanish version targets
 * the same "carta de reclamación" / "carta de cobro" intent for
 * Spanish-speaking tenants and consumers).
 */
export type EsTemplate = {
  slug: string;
  /** Slug of the English template this translates, for hreflang + cross-links. */
  enSlug: string;
  title: string;
  oneLine: string;
  category: string;
  lastReviewed: string;
  context: string;
  warnings: string[];
  body: string;
  keywords: string[];
};

export const ES_TEMPLATES: EsTemplate[] = [
  {
    slug: 'carta-de-demanda',
    enSlug: 'demand-letter',
    title: 'Modelo de Carta de Demanda',
    oneLine:
      'Una carta de demanda pide formalmente que alguien resuelva un problema (que pague un dinero, devuelva una propiedad, o deje de hacer algo) antes de que lo lleves a juicio. La mayoría de los tribunales esperan ver una. Enviar una resuelve cerca del 60% de las disputas sin necesidad de litigar.',
    category: 'Antes de litigar',
    lastReviewed: '2026-06-08',
    context:
      'Envía una carta de demanda cuando tienes un problema específico y cuantificable en dinero con una persona o negocio específico, y quieres que lo resuelvan sin ir a juicio. La carta hace tres cosas: expone los hechos con claridad, le pone un número al daño, y da una fecha límite para responder. Mantenla factual y cortés - puede terminar como Prueba A en un caso de reclamos menores (small claims).',
    warnings: [
      'Envíala por correo electrónico Y por correo certificado con acuse de recibo; guarda ambos comprobantes de entrega.',
      'No amenaces con algo que en realidad no harías. Una carta de demanda que dice "lo demandaremos" debe ser una carta que estés dispuesto a cumplir.',
      'En algunas jurisdicciones, una carta de demanda puede iniciar o pausar el plazo de prescripción (statute of limitations). Verifica las reglas de tu estado.',
      'No incluyas ninguna oferta de arreglo que no estés dispuesto a cumplir; una oferta aceptada se convierte en un contrato vinculante.',
    ],
    body: `{{Tu Nombre Completo}}
{{Tu Dirección}}
{{Tu Ciudad, Estado, Código Postal}}
{{Tu Correo Electrónico}}
{{Tu Teléfono}}

{{Fecha}}

Vía Correo Certificado y Correo Electrónico

{{Nombre Completo del Destinatario o Nombre del Negocio}}
{{Dirección del Destinatario}}
{{Ciudad, Estado, Código Postal del Destinatario}}

Re: Demanda de {{breve descripción, ej. "Devolución del Depósito de Seguridad de $5,000"}}

Estimado(a) {{Destinatario}}:

Le escribo para exigir formalmente {{describe la acción que quieres, ej. "la devolución de mi depósito de seguridad de $5,000"}}. Los hechos relevantes son los siguientes:

1. {{Primer hecho en orden cronológico. Sé específico: fechas, montos, lugar, personas involucradas.}}
2. {{Segundo hecho.}}
3. {{Tercer hecho, incluyendo el acto u omisión que causó el daño.}}

A pesar de {{describe cualquier intento previo de resolver el asunto, ej. "mi correo electrónico del 15 de enero de 2026 y mi llamada de seguimiento del 1 de febrero"}}, este asunto sigue sin resolverse.

Se me debe la cantidad de {{monto exacto en dólares, ej. "$5,000"}}. Estoy dispuesto(a) a resolver este asunto sin necesidad de litigar si paga esta cantidad en su totalidad antes del {{fecha límite - normalmente entre 14 y 30 días a partir de esta carta, ej. "15 de marzo de 2026"}}.

Si no recibo el pago antes de esa fecha, procederé con todos los recursos legales disponibles, lo cual puede incluir presentar una demanda civil en {{tribunal, ej. "el tribunal de reclamos menores del condado de Hennepin"}}, donde además buscaré el reembolso de los costos judiciales e intereses legales. {{Opcional: "Ya he comenzado a preparar los documentos necesarios para el tribunal."}}

Por favor envíe el pago a la dirección indicada arriba. Prefiero recibir el pago por {{cheque / transferencia bancaria / depósito a la cuenta que termina en XXXX}}.

Esta carta constituye mi intento de buena fe para resolver este asunto de manera informal. Se conservará una copia para cualquier procedimiento legal posterior.

Atentamente,

{{Firma}}
{{Tu Nombre en Letra de Molde}}

Anexos: {{lista de cualquier documento de respaldo que estés adjuntando, ej. "Contrato de arrendamiento, recibo del depósito de seguridad, fotos del estado de la propiedad al momento de la mudanza"}}`,
    keywords: [
      'modelo de carta de demanda',
      'cómo escribir una carta de demanda',
      'carta de demanda gratis en español',
      'carta de cobro de dinero',
      'carta de reclamación antes de demandar',
    ],
  },
];

export function getEsTemplate(slug: string): EsTemplate | null {
  return ES_TEMPLATES.find((t) => t.slug === slug) ?? null;
}
