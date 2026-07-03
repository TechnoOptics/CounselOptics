import type { GuideFaq, GuideStep } from '@/lib/guides';

/**
 * Spanish-language guides. Content-only translation, not a
 * full-product i18n system - the app itself stays English-only for
 * now. These are standalone pages at /es/guias/<slug> that mirror
 * their English counterpart's substance so a Spanish-speaking
 * search or LLM query gets the same quality of answer.
 *
 * Every entry carries `enSlug` so the page can link back to the
 * English original and both pages can set `alternates.languages`
 * on each other (hreflang). Keep the two versions in sync when the
 * English source is updated - stale legal content in either
 * language is worse than no page at all.
 */
export type EsGuide = {
  slug: string;
  /** Slug of the English guide this translates, for hreflang + cross-links. */
  enSlug: string;
  title: string;
  oneLine: string;
  category: string;
  lastReviewed: string;
  intro: string;
  steps: GuideStep[];
  faqs: GuideFaq[];
  crisis?: boolean;
  keywords: string[];
};

export const ES_GUIDES: EsGuide[] = [
  {
    slug: 'mi-arrendador-me-esta-desalojando',
    enSlug: 'my-landlord-is-evicting-me',
    title: 'Mi arrendador me quiere desalojar. ¿Cuáles son mis derechos?',
    oneLine:
      'El desalojo es un proceso legal con pasos obligatorios: aviso por escrito, demanda ante el tribunal, audiencia y, solo al final, una orden judicial. Tienes defensas en cada paso. El "autodesalojo" (cambiar las cerraduras, cortar los servicios) es ilegal en todos los estados.',
    category: 'Defensa del inquilino',
    lastReviewed: '2026-06-08',
    intro:
      'El desalojo es un proceso legal, no una decisión privada que el arrendador pueda tomar por su cuenta. Cada estado exige que el arrendador siga pasos específicos, en orden: aviso por escrito, demanda presentada ante el tribunal, una audiencia donde te pueden escuchar, y solo después una orden de posesión que permite al alguacil -no al arrendador- sacarte físicamente. Tienes defensas reales en cada paso, y no las pierdes solo porque debes renta.',
    steps: [
      {
        title: 'Guarda por escrito cada aviso que recibas',
        detail:
          'El aviso debe indicar el motivo (falta de pago, violación del contrato, permanencia indebida) y la fecha límite para corregir la situación o desocupar. Sin un aviso válido, el caso de desalojo puede ser desestimado. Si solo recibiste una advertencia verbal, en la mayoría de los estados eso no es suficiente.',
      },
      {
        title: 'Anota la fecha de la audiencia en tu calendario',
        detail:
          'Los casos de desalojo se mueven rápido: en la mayoría de los estados, de 7 a 30 días desde que te notifican hasta la audiencia. Si faltas a la audiencia, el juez puede fallar en tu contra automáticamente. Anótala de inmediato.',
      },
      {
        title: 'Identifica tus defensas',
        detail:
          'Defensas comunes: aviso indebido, represalia (te quejaste por reparaciones o reportaste una violación del código), habitabilidad (la vivienda no era habitable), discriminación (raza, estado familiar, discapacidad, fuente de ingresos), un pago parcial que el arrendador aceptó, o protecciones especiales contra el desalojo bajo ciertos programas federales.',
      },
      {
        title: 'Paga o negocia antes de la audiencia si puedes',
        detail:
          'Si el desalojo es por falta de pago y puedes pagar toda la renta atrasada más los costos judiciales antes de la audiencia (a veces llamado "pagar y quedarte"), la mayoría de los estados exige que el tribunal desestime el caso. Negociar un plan de pagos por escrito también ayuda: consigue que cualquier acuerdo esté firmado y presentado ante el tribunal.',
      },
      {
        title: 'Preséntate a la audiencia preparado',
        detail:
          'Lleva todos los documentos: el contrato de arrendamiento, los avisos, los recibos de pago, las solicitudes de reparación, fotos de las condiciones de la vivienda, y cualquier comunicación con el arrendador. Sé respetuoso. Diríjete al juez como "Su Señoría". Cuenta tu versión con calma y con hechos. La mayoría de los desalojos se ganan o se pierden por los documentos, no por lo que se dice.',
      },
    ],
    faqs: [
      {
        question: '¿Puede mi arrendador cambiar las cerraduras o cortar los servicios?',
        answer:
          'No. El "autodesalojo" -cambiar las cerraduras, sacar tus pertenencias, cortar el agua, la luz o el gas, o cualquier táctica para obligarte a irte sin una orden judicial- es ilegal en todos los estados. Si tu arrendador hace esto, documéntalo (fotos, video, mensajes de texto) y llama de inmediato a la línea de derechos del inquilino de tu localidad. Muchos estados imponen sanciones importantes (a menudo de 2 a 3 veces los daños) a los arrendadores que hacen esto.',
        },
      {
        question: '¿El desalojo quedará en mi historial?',
        answer:
          'Los casos de desalojo presentados permanecen en las bases de datos de verificación de inquilinos por 7 años o más en la mayoría de los estados, incluso si ganaste el caso. Algunos estados (CA, NY, IL, entre otros) sellan el registro cuando el inquilino gana. Habla con un abogado de inquilinos sobre sellar tu registro tan pronto como termine el caso.',
      },
      {
        question: 'No puedo pagar un abogado. ¿Qué hago?',
        answer:
          'Las oficinas de asistencia legal gratuita (legal aid) en todos los estados manejan la defensa de desalojos para inquilinos por debajo de cierto nivel de ingresos (usualmente entre 200% y 400% del nivel federal de pobreza). Las organizaciones de derechos del inquilino a menudo tienen clínicas el mismo día de la audiencia. Usa el directorio Find Counsel de Advottic para buscar asistencia legal gratuita y abogados pro bono en tu área.',
      },
    ],
    keywords: [
      'mi arrendador me quiere desalojar',
      'defensa contra el desalojo',
      'derechos del inquilino desalojo',
      'autodesalojo ilegal',
      'proceso de desalojo',
      'cómo defenderme de un desalojo',
    ],
  },
  {
    slug: 'ayuda-violencia-domestica',
    enSlug: 'i-need-help-domestic-violence',
    title: 'Alguien me está haciendo daño. ¿Qué hago?',
    oneLine:
      'Ponte a salvo primero, llama al 911 si es una emergencia o a la Línea Nacional de Violencia Doméstica al 1-800-799-7233 para apoyo confidencial, documenta lo que puedas y solicita una orden de protección en el tribunal de tu localidad - las audiencias suelen ser el mismo día o al día siguiente.',
    category: 'Seguridad personal',
    lastReviewed: '2026-06-08',
    crisis: true,
    intro:
      'Si estás leyendo esto desde un lugar seguro: gracias por confiar lo suficiente como para buscar información. Si estás leyendo esto y la persona que te hace daño podría ver tu pantalla, cierra esta página y llama al 1-800-799-7233 (Línea Nacional de Violencia Doméstica) desde un teléfono al que esa persona no tenga acceso, o envía un mensaje de texto con la palabra START al 88788. La ayuda es real, gratuita y confidencial.\n\nLo que sigue es una lista práctica y tranquila para los días después de que estés físicamente a salvo. Nada de esto es asesoría legal. Cada paso está pensado para devolverte una sensación de control.',
    steps: [
      {
        title: 'Ponte a salvo físicamente primero',
        detail:
          'Si estás en peligro inmediato, llama al 911. Si puedes irte, vete: a casa de un amigo, a un refugio, a un hospital o a un hotel. La Línea Nacional de Violencia Doméstica (1-800-799-7233) puede ayudarte a encontrar un refugio y hacer un plan de seguridad en tu área, las 24 horas del día, en más de 200 idiomas, incluido el español.',
      },
      {
        title: 'Documenta lo que puedas, cuando puedas',
        detail:
          'Fotos de lesiones (con fecha). Capturas de pantalla de amenazas. Mensajes de voz. Mensajes de texto. Registros del hospital. Números de reportes policiales. Guarda todo en un almacenamiento en la nube al que la persona agresora no tenga acceso (una cuenta de Gmail nueva, un Dropbox que no conozca, incluso una memoria USB en casa de un amigo). La documentación es importante para las órdenes de protección, la custodia y los casos penales más adelante.',
      },
      {
        title: 'Solicita una orden de protección en el tribunal de tu localidad',
        detail:
          'Todos los estados ofrecen órdenes de protección de emergencia (a veces llamadas órdenes de restricción) que puedes solicitar sin abogado, generalmente el mismo día o al día siguiente. La oficina del secretario del tribunal tiene los formularios. La audiencia es ante un juez; la persona agresora no tiene que estar presente para la orden inicial. Una orden de emergencia típica dura de 14 a 30 días; una orden a más largo plazo se define en una audiencia de seguimiento.',
      },
      {
        title: 'Comunícate con un defensor de víctimas',
        detail:
          'Cada oficina de fiscalía tiene defensores de víctimas cuyo trabajo es ayudarte a entender el sistema. Son gratuitos y confidenciales. Pueden ayudarte con un plan de seguridad, acompañamiento al tribunal, encontrar vivienda, encontrar apoyo psicológico y solicitar fondos de compensación para víctimas.',
      },
      {
        title: 'Planea a mediano plazo',
        detail:
          'Safe Witness (en Advottic) envía un mensaje de texto con tu ubicación a tus contactos de confianza cuando mantienes presionado el botón. Cambia las contraseñas, los contactos de recuperación de cuentas y la verificación en dos pasos en cada cuenta. Si tienen finanzas compartidas, consulta con un asesor financiero (la línea de ayuda puede recomendarte uno). Si hay menores involucrados, habla con un abogado de derecho familiar sobre las opciones de custodia - la mayoría de las organizaciones de asistencia legal gratuita priorizan estos casos.',
      },
    ],
    faqs: [
      {
        question: '¿La policía tomará en serio mi denuncia?',
        answer:
          'Por ley federal y estatal, sí, y la capacitación policial ha mejorado mucho en la última década. Lleva una lista de fechas, lugares, testigos y cualquier documentación. Pide el número de reporte antes de irte. Si sientes que un oficial en particular no te está tomando en serio, puedes pedir hablar con un supervisor o con la unidad de violencia doméstica.',
      },
      {
        question: '¿Necesito un abogado para una orden de protección?',
        answer:
          'No. Las solicitudes de orden de protección están diseñadas para presentarse sin abogado. La oficina del secretario del tribunal tiene los formularios. Muchas organizaciones locales contra la violencia doméstica ofrecen ayuda gratuita para llenarlos. Si la persona agresora contrata un abogado para la audiencia de seguimiento, pide asistencia legal gratuita - muchos estados priorizan los casos de violencia doméstica.',
      },
      {
        question: 'Tengo miedo de irme. ¿Hay alguien que me ayude a planear?',
        answer:
          'Sí. La Línea Nacional de Violencia Doméstica (1-800-799-7233) y la Crisis Text Line (envía HOLA al 741741) están disponibles las 24 horas, son gratuitas y confidenciales, y atienden en español. Si no puedes hacer una llamada, la línea de ayuda tiene una opción de chat en thehotline.org.',
      },
      {
        question: '¿Qué hace Advottic en estos casos?',
        answer:
          'Advottic ofrece Safe Witness (un botón que mantienes presionado en tu reloj o en la aplicación web y que envía una alerta con tu ubicación a tus contactos de confianza), organización del caso para cualquier asunto legal relacionado, y el directorio Find Counsel para ayudarte a encontrar un abogado de derecho familiar o de violencia doméstica. Advottic no es un despacho de abogados y no ofrece asesoría legal. Las líneas de crisis mencionadas arriba siempre deben ser tu primera llamada.',
      },
    ],
    keywords: [
      'ayuda violencia doméstica',
      'cómo obtener una orden de restricción',
      'orden de protección',
      'línea nacional de violencia doméstica en español',
      'me están maltratando',
      'safe witness',
    ],
  },
];

export function getEsGuide(slug: string): EsGuide | null {
  return ES_GUIDES.find((g) => g.slug === slug) ?? null;
}
