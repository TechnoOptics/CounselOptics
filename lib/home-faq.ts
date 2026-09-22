/**
 * The six questions on the page. This array feeds BOTH the visible list in
 * WhatItIsNot and the FAQPage JSON-LD in HomeStructuredData, so the markup
 * and the page cannot disagree. Google penalises a mismatch.
 */
export const HOME_FAQ: { q: string; a: string }[] = [
  {
    q: 'Is Advottic legal advice?',
    a: 'No, and we will never pretend it is. Advottic helps you keep your story tidy and your evidence organized. We are not a law firm and we do not create an attorney-client relationship. For decisions that matter, please talk to a licensed attorney.',
  },
  {
    q: 'I am facing criminal charges. Can Advottic help?',
    a: 'Please reach out to a public defender right away if there is any chance of incarceration. That help is free and your constitutional right. Advottic can hold the timeline and the documents in the meantime, but a real attorney is what you need first.',
  },
  {
    q: 'Where is my information kept?',
    a: 'Your case lives in a private, encrypted database, and your uploads sit in a private file vault. Only your account can open them. You can export everything you have written or uploaded at any time.',
  },
  {
    q: 'Can my attorney see my case?',
    a: 'Yes, on the Pro plan you can invite them by email. They can read the file and add to it, and you stay in charge of who has access. Remove them whenever you like.',
  },
  {
    q: 'What is Bella?',
    a: 'Bella is the assistant built into Advottic. She summarizes your case file, drafts documents from templates, and answers plain-English questions about your matter, always telling you which tool she used to get an answer. She is a research and organizing aid, not a lawyer, and never replaces legal advice.',
  },
  {
    q: 'What is Safe Witness?',
    a: 'The personal-safety feature. A press-and-hold, on the app or a paired Wear OS watch, sends a one-time alert with your live location to the trusted contacts you have chosen, plus a one-tap way to call 911. It requires your explicit action every time. Nothing runs in the background without you triggering it.',
  },
];
