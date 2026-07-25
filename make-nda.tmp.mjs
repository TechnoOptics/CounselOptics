import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const FIRM='a8c1461f-6f83-4f85-96bb-93fad549581d';
const TEXT=`MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement (the "Agreement") is entered into as of July 26, 2026 (the "Effective Date") by and between:

Anderson Foundation, with its principal place of business at its registered offices ("Company"), and

Acme Ventures LLC, of 200 Market Street, Minneapolis, MN ("Counterparty").

1. PURPOSE. The Parties wish to explore a product pilot and, in connection with it, each Party may disclose confidential technical and business information.

2. CONFIDENTIAL INFORMATION. "Confidential Information" means any information disclosed by either Party that is designated as confidential or reasonably should be understood to be confidential. It excludes information that is or becomes public without fault, was rightfully known before disclosure, or is independently developed.

3. OBLIGATIONS. Each Party will hold the other's Confidential Information in strict confidence, not disclose it to third parties without written consent, use it only for the Purpose, and protect it with at least reasonable care.

4. TERM. Two (2) years from the Effective Date; confidentiality obligations survive three (3) years beyond expiration.

5. RETURN OF MATERIALS. On request, each Party will return or destroy the other's Confidential Information.

6. NO LICENSE. No intellectual-property rights are granted except as expressly stated.

7. GOVERNING LAW. State of Minnesota.

8. ENTIRE AGREEMENT. This Agreement supersedes all prior discussions on this subject.

AGREED AND ACCEPTED as of the Effective Date.

For Anderson Foundation:            For Acme Ventures LLC:
Name:  Jordan Anderson              Name:  ______________________
Title: Director                     Title: ______________________
Signature: Jordan Anderson          Signature: __________________`;

const pdf = await PDFDocument.create();
pdf.setTitle('Sample Mutual NDA (example)');
const font = await pdf.embedFont(StandardFonts.TimesRoman);
const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
let page = pdf.addPage([612,792]); let y = 792-64;
const wrap=(t,f,s,w)=>{const words=t.split(' ');const lines=[];let cur='';for(const wd of words){const test=cur?cur+' '+wd:wd;if(f.widthOfTextAtSize(test,s)>w){lines.push(cur);cur=wd;}else cur=test;}if(cur)lines.push(cur);return lines;};
for (const para of TEXT.split('\n')) {
  const isTitle = para === 'MUTUAL NON-DISCLOSURE AGREEMENT';
  const f = isTitle||/^\d\./.test(para)?bold:font; const size=isTitle?14:11;
  const lines = para===''?['']:wrap(para,f,size,612-128);
  for(const line of lines){
    if(y<72){page=pdf.addPage([612,792]);y=792-64;}
    if(line) page.drawText(line,{x:64,y,size,font:f,color:rgb(0.06,0.11,0.09)});
    y-=size*1.45;
  }
  y-=3;
}
const bytes = await pdf.save();
const path = `${FIRM}/samples/sample-mutual-nda.pdf`;
const up = await admin.storage.from('firm-documents').upload(path, Buffer.from(bytes), {contentType:'application/pdf', upsert:true});
if(up.error) throw up.error;
const ins = await admin.from('firm_documents').insert({
  firm_id: FIRM, name: 'Sample Mutual NDA (example)', mime_type: 'application/pdf',
  file_path: path, file_size: bytes.length, version: 1, status: 'draft',
  description: 'Example output of the Mutual NDA form template — for demos. Employees fill the live template under Hub → Forms.',
  tags: ['Templates','NDA'],
}).select('id').single();
if(ins.error) throw ins.error;
console.log('uploaded + filed:', ins.data.id, `${bytes.length} bytes`);
