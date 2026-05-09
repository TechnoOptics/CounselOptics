import { NextResponse } from 'next/server';
import { getCase } from '@/lib/storage';

/**
 * Hearing as an iCalendar (.ics) file. Phones, Google Calendar,
 * Outlook, and Apple Calendar all open .ics from a download or a
 * tap. The user gets a 60-minute event (default) tagged with the
 * case title, court location, and notes - so when their phone
 * pings them on hearing day they don't have to re-derive the
 * details from email.
 *
 * Public-ish endpoint: requires the case to load (which RLS gates),
 * but doesn't bake any private metadata into the response that
 * isn't already on the case page.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const caseRecord = await getCase(params.id);
  if (!caseRecord) return new NextResponse('Case not found', { status: 404 });
  if (!caseRecord.hearingAt) {
    return new NextResponse('No hearing scheduled for this case', { status: 404 });
  }

  const start = new Date(caseRecord.hearingAt);
  if (Number.isNaN(start.getTime())) {
    return new NextResponse('Hearing date is invalid', { status: 422 });
  }
  // Default duration: 60 minutes. Most state-court hearings run
  // shorter than that, but 60 minutes is a reasonable hold so
  // users don't double-book themselves.
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const ics = buildIcs({
    uid: `hearing-${caseRecord.id}@advottic.com`,
    summary: `Hearing - ${caseRecord.title}`,
    description: [
      caseRecord.subjectName ? `Subject: ${caseRecord.subjectName}` : null,
      caseRecord.caseType ? `Case type: ${caseRecord.caseType}` : null,
      caseRecord.hearingNotes ? `\n${caseRecord.hearingNotes}` : null,
      `\nManaged in Advottic - https://advottic.com/cases/${caseRecord.id}`,
    ]
      .filter(Boolean)
      .join('\n'),
    location: caseRecord.hearingLocation ?? '',
    start,
    end,
  });

  const safeTitle = caseRecord.title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'hearing';
  const filename = `${safeTitle}.ics`;

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}

function buildIcs(opts: {
  uid: string;
  summary: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
}): string {
  const stamp = formatIcsDate(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Advottic//Hearing//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(opts.uid)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${formatIcsDate(opts.start)}`,
    `DTEND:${formatIcsDate(opts.end)}`,
    `SUMMARY:${escapeText(opts.summary)}`,
    `DESCRIPTION:${escapeText(opts.description)}`,
    opts.location ? `LOCATION:${escapeText(opts.location)}` : null,
    // 30-minute pre-hearing reminder. Most calendar clients honor this.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT30M',
    'DESCRIPTION:Hearing in 30 minutes',
    'END:VALARM',
    // 1-day reminder.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-P1D',
    'DESCRIPTION:Hearing tomorrow',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean) as string[];
  // RFC 5545: lines should fold at 75 octets, joined by CRLF.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function formatIcsDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ - always UTC since we store ISO timestamps.
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let rest = line;
  out.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    out.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) out.push(' ' + rest);
  return out.join('\r\n');
}
