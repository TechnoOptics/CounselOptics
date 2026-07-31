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
    slug: 'me-demandaron-que-hago',
    enSlug: 'i-was-served-with-a-lawsuit',
    title: 'Me notificaron una demanda. ¿Qué hago?',
    oneLine:
      'Lee la demanda, anota en tu calendario la fecha límite para responder (usualmente de 20 a 30 días), decide si vas a responder por tu cuenta o contratar un abogado, y nunca ignores la notificación.',
    category: 'Demandado civil',
    lastReviewed: '2026-06-08',
    intro:
      'Que te notifiquen una demanda da miedo, y es comprensible. La buena noticia: el proceso tiene una estructura. Cada estado te da un plazo fijo para responder (típicamente de 20 a 30 días desde la notificación), y durante ese plazo tienes opciones reales. Lo más peligroso que puedes hacer es ignorar la citación: el demandante puede obtener una sentencia en tu contra por el monto total que pide, y a partir de ahí es una batalla mucho más difícil.',
    steps: [
      {
        title: 'Lee cada página de la citación y la demanda',
        detail:
          'La citación te dice en qué tribunal, con qué número de caso, y cuántos días tienes para responder. La demanda te dice qué alega el demandante que hiciste y qué quiere de ti. Marca tres cosas: la fecha límite, el monto exacto en dólares, y cualquier hecho con el que estés en total desacuerdo.',
      },
      {
        title: 'Anota la fecha límite de inmediato',
        detail:
          'La mayoría de los estados dan de 20 a 30 días desde la fecha de notificación. Algunos casos federales dan 21. Pon la fecha límite en dos lugares diferentes (teléfono y papel) y pon un recordatorio una semana antes. Si la pierdes, el resultado es una sentencia en tu contra y luego cobranza.',
      },
      {
        title: 'Decide si manejarlo tú mismo o contratar un abogado',
        detail:
          'Si el monto está por debajo del límite de reclamos menores de tu estado (usualmente entre $5,000 y $25,000) y los hechos son simples, manejarlo tú mismo es razonable. Si es algo complejo -disputa de contrato, empleo, o cualquier cosa donde los honorarios de abogado estén en juego- consigue una consulta; muchos abogados ofrecen 30 minutos gratis para casos nuevos.',
      },
      {
        title: 'Presenta una Respuesta ante el tribunal antes de la fecha límite',
        detail:
          'Una Respuesta es un documento corto que responde a cada párrafo numerado de la demanda con admito / niego / no tengo suficiente información para admitir o negar. Puedes escribir una tú mismo sin costo (el sitio web del tribunal de cada estado tiene formularios) o pedirle a un abogado que redacte una por $300 a $800.',
      },
      {
        title: 'Guarda cada documento y nunca te comuniques directamente con el demandante',
        detail:
          'Una vez presentada la demanda, toda comunicación debe pasar por el tribunal o por un abogado. Cualquier mensaje de texto, correo o mensaje de voz que le envíes al demandante puede usarse como evidencia.',
      },
    ],
    faqs: [
      {
        question: '¿Qué pasa si ignoro la demanda?',
        answer:
          'El demandante puede pedirle al tribunal una sentencia en tu contra por el monto total que reclamó, más los costos judiciales y, en algunos casos, los honorarios de abogado. Esa sentencia es cobrable: pueden embargar tu salario, tus cuentas bancarias, y en algunos estados poner un gravamen sobre tu casa.',
      },
      {
        question: '¿Necesito un abogado para responder?',
        answer:
          'No necesariamente, pero depende. Los reclamos menores y los asuntos simples por debajo del límite para representarte a ti mismo se manejan comúnmente sin abogado. Para cualquier cosa con exposición monetaria significativa, reclamos laborales, disputas de contrato, o cuando la otra parte tiene abogado, una consulta vale la pena aunque al final manejes la respuesta tú mismo.',
      },
      {
        question: '¿Puedo simplemente llamar al demandante y llegar a un acuerdo?',
        answer:
          'Puedes intentarlo, pero ten cuidado. Cualquier admisión que hagas puede usarse como evidencia si el caso llega a juicio. Si quieres llegar a un acuerdo, ponlo por escrito, fírmalo ambas partes, y preséntalo ante el tribunal como una estipulación, o haz que un abogado lo revise antes de firmar.',
      },
      {
        question: '¿Qué hace Advottic en estos casos?',
        answer:
          'Advottic organiza el archivo del caso: seguimiento de fechas límite, paquetes de pruebas, Bella para ayudarte a redactar un primer borrador de Respuesta, y el directorio Find Counsel si decides contratar un abogado. La plataforma no es un despacho de abogados y no ofrece asesoría legal; consulta a un abogado con licencia en tu jurisdicción antes de presentar algo que no redactaste tú mismo.',
      },
    ],
    keywords: [
      'me notificaron una demanda',
      'cómo responder a una demanda',
      'cuántos días tengo para responder una demanda',
      'respuesta a una demanda sin abogado',
      'sentencia en rebeldía',
      'me demandaron',
    ],
  },
  {
    slug: 'cuanto-tiempo-tengo-para-demandar',
    enSlug: 'how-long-do-i-have-to-sue',
    title: '¿Cuánto tiempo tengo para demandar? (Lo básico sobre la prescripción)',
    oneLine:
      'La mayoría de los reclamos por lesiones personales tienen de 2 a 3 años; la mayoría de los reclamos de contrato, de 4 a 6; muchos reclamos civiles, 2 años; algunos casos de restitución penal y de abuso sexual infantil no tienen límite. El plazo generalmente comienza en la fecha de la lesión o del descubrimiento del daño.',
    category: 'Plazo de prescripción',
    lastReviewed: '2026-06-08',
    intro:
      'Cada estado fija una fecha límite (el plazo de prescripción) para presentar una demanda civil, y una vez que se cumple ese plazo, el derecho a demandar se pierde de forma permanente. La duración exacta depende del tipo de reclamo que presentas Y del estado en el que te encuentras. Las reglas de abajo son el panorama general a nivel nacional; el plazo específico de tu estado es el único que realmente aplica a tu caso.',
    steps: [
      {
        title: 'Identifica el tipo de reclamo',
        detail:
          'Distintos reclamos tienen distintos plazos. Lesiones personales (accidentes de auto, resbalones y caídas): comúnmente de 2 a 3 años. Disputas de contrato (por escrito): comúnmente de 4 a 6 años. Disputas de contrato (verbal): comúnmente de 2 a 4 años. Daño a la propiedad: comúnmente de 2 a 3 años. Negligencia médica: comúnmente de 1 a 3 años (con reglas especiales de descubrimiento). Muerte por negligencia: comúnmente de 1 a 2 años desde el fallecimiento.',
      },
      {
        title: 'Determina cuándo comenzó el plazo',
        detail:
          'Para la mayoría de los reclamos, el plazo comienza en la fecha de la lesión. Para lesiones latentes (exposición a moho, asbesto, fraude descubierto años después) la mayoría de los estados aplica una regla de descubrimiento: el plazo comienza cuando supiste o deberías haber sabido que sufriste un daño.',
      },
      {
        title: 'Verifica si aplica una pausa del plazo (tolling)',
        detail:
          'El "tolling" pausa el plazo. Las razones más comunes: el demandante es menor de edad (el plazo se pausa hasta los 18 años), el demandado salió del estado, el demandado ocultó fraudulentamente el daño, o una emergencia estatal declaró una pausa (algunas extensiones de la era del COVID aún aplican en California y algunos otros estados).',
      },
      {
        title: 'Busca tu estado y tipo de reclamo específico',
        detail:
          'Los números de arriba son promedios generales a nivel nacional. Siempre confirma tu estado y reclamo específico con las reglas de procedimiento civil de tu estado o con un abogado. Algunos estados tienen plazos inusualmente cortos (Luisiana tiene un plazo de un año para lesiones personales; Kentucky tiene un plazo de un año para difamación).',
      },
      {
        title: 'Presenta la demanda antes de la fecha límite aunque aún no tengas abogado',
        detail:
          'Si la fecha límite está cerca, puedes presentar tú mismo una demanda de una página para detener el plazo, y luego agregar detalles y contratar un abogado después. Una demanda presentada pero imperfecta se puede corregir; una fecha límite perdida no.',
      },
    ],
    faqs: [
      {
        question: '¿Qué pasa si pierdo el plazo de prescripción?',
        answer:
          'Tu derecho a demandar se pierde de forma permanente. El demandado presentará una moción para desestimar por prescripción y la ganará, sin importar qué tan fuerte sea tu reclamo. Existen excepciones raras por pausa del plazo u ocultamiento fraudulento, pero son difíciles de ganar.',
      },
      {
        question: '¿El plazo de prescripción aplica a casos penales?',
        answer:
          'La mayoría de los cargos penales tienen su propio plazo de prescripción (usualmente más largo). Algunos -notablemente el homicidio y, en muchos estados, el abuso sexual infantil- no tienen límite. El plazo de prescripción en casos penales lo fija la fiscalía, no la víctima.',
      },
      {
        question: '¿Puedo extender la fecha límite hablando con la otra parte?',
        answer:
          'Solo con un acuerdo de pausa (tolling) firmado por escrito por ambas partes. Las conversaciones informales, las pláticas de arreglo, e incluso las ofertas formales NO detienen el plazo a menos que haya un documento firmado.',
      },
      {
        question: '¿Cómo ayuda Advottic?',
        answer:
          'El Deadline Radar de Advottic da seguimiento a los plazos de prescripción de cada caso en tu archivo, incluyendo pausas específicas de tu jurisdicción. Bella puede responder preguntas en lenguaje sencillo sobre qué plazo aplica a tus hechos específicos. Ninguno de los dos reemplaza una consulta con un abogado con licencia en tu estado.',
      },
    ],
    keywords: [
      'plazo de prescripción',
      'cuánto tiempo tengo para demandar',
      'prescripción por estado',
      'pausa del plazo de prescripción',
      'regla de descubrimiento',
      'prescripción lesiones personales',
    ],
  },
  {
    slug: 'me-demandan-por-deuda-de-tarjeta-de-credito',
    enSlug: 'im-being-sued-for-credit-card-debt',
    title: 'Me están demandando por una deuda de tarjeta de crédito. ¿Qué hago?',
    oneLine:
      'Lee la demanda y verifica las cifras, exige la cadena de propiedad del acreedor original (a menudo el comprador de la deuda no puede probarla), presenta una Respuesta antes de la fecha límite, alega prescripción y falta de legitimación si aplica, y negocia desde una posición de fuerza si es necesario.',
    category: 'Defensa de deuda del consumidor',
    lastReviewed: '2026-06-08',
    intro:
      'La mayoría de las demandas por deuda de tarjeta de crédito las presentan empresas compradoras de deuda que adquirieron la cuenta del acreedor original por centavos de dólar. Muchas veces no pueden presentar los documentos de la cadena de propiedad que exige el tribunal. Cerca del 70% de los casos de cobranza de tarjetas de crédito terminan en sentencia en rebeldía porque el demandado no respondió; el simple hecho de presentarte y exigir pruebas cambia la dinámica drásticamente.',
    steps: [
      {
        title: 'Lee la demanda y verifica las cifras',
        detail:
          'Revisa el capital, la tasa de interés, los cargos y el total. Compáralo con cualquier estado de cuenta que tengas. Los errores son comunes: cuenta equivocada, monto equivocado, cargos apilados sobre otros cargos. Anota cada discrepancia.',
      },
      {
        title: 'Presenta una Respuesta antes de la fecha límite',
        detail:
          'La mayoría de los estados dan de 20 a 30 días. La Respuesta debe: negar cada párrafo que no puedas verificar, exigir prueba estricta, y presentar defensas afirmativas. Defensas afirmativas comunes en casos de deuda: prescripción (la mayoría de los estados son de 3 a 6 años desde el último pago), falta de legitimación (el demandante no puede probar que es dueño de la deuda), y violaciones a la ley federal de cobranza (FDCPA).',
      },
      {
        title: 'Envía una solicitud por escrito de prueba de propiedad y estado de cuenta',
        detail:
          'Bajo la ley federal de cobranza (FDCPA) y la mayoría de las reglas estatales de procedimiento civil, puedes exigir: el contrato de crédito original firmado, cada documento de venta que muestre la cadena de propiedad desde el acreedor original hasta el demandante, y un estado de cuenta completo desde la fecha del último pago. Los compradores de deuda a menudo no pueden presentar esto.',
      },
      {
        title: 'Alega prescripción si aplica',
        detail:
          'Cada estado tiene su propio plazo para deuda de tarjeta de crédito (de 3 a 6 años en la mayoría de los estados), usualmente contado desde la fecha del último pago O de la última actividad en la cuenta. Si han pasado más de 4 años desde que pagaste algo en esta cuenta, vale la pena alegar la defensa de prescripción. Ten cuidado: hacer un pago parcial o incluso confirmar la deuda por escrito puede reiniciar el plazo en algunos estados.',
      },
      {
        title: 'Negocia desde una posición de fuerza',
        detail:
          'Una vez que presentaste una Respuesta y exigiste pruebas, la economía del comprador de deuda cambia: pagaron centavos de dólar y ahora tienen que gastar tiempo de abogado. Los arreglos de 10 a 30 centavos por dólar son comunes. Pon cualquier arreglo por escrito, incluye una cláusula de satisfacción de sentencia, y confirma que el demandante desestimará el caso con perjuicio.',
      },
    ],
    faqs: [
      {
        question: '¿Debería simplemente pagar el monto completo para que desaparezca?',
        answer:
          'Casi nunca. La mayoría de los casos se arreglan por 10% a 30% del monto reclamado una vez que exiges pruebas. Pagar el monto completo también confirma la deuda y puede reiniciar el plazo de prescripción en cuentas relacionadas.',
      },
      {
        question: '¿Esto afectará mi crédito?',
        answer:
          'Una demanda presentada por sí sola no aparece en los reportes de crédito al consumidor (eso cambió en 2017). Una sentencia tampoco aparece. Pero la morosidad subyacente sí. Arreglar la sentencia por escrito con lenguaje de "pagado en su totalidad" o "satisfacción de sentencia" ayuda mucho.',
      },
      {
        question: '¿Y si la deuda es mía y tienen todos los documentos?',
        answer:
          'Entonces negocia. Los compradores de deuda arreglan incluso casos fuertes porque pagaron centavos de dólar y quieren cerrar el archivo. Una oferta inicial razonable es 30 centavos por dólar con un plan de pagos estructurado. Siempre pon el acuerdo por escrito y preséntalo ante el tribunal.',
      },
    ],
    keywords: [
      'me demandan por deuda de tarjeta de crédito',
      'demanda de comprador de deuda',
      'defensa fdcpa',
      'prescripción deuda de tarjeta de crédito',
      'demanda de cobranza',
    ],
  },
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
          'Sí. La Línea Nacional de Violencia Doméstica (1-800-799-7233) y la Crisis Text Line (envía AYUDA al 741741) están disponibles las 24 horas, son gratuitas y confidenciales, y atienden en español. Si no puedes hacer una llamada, la línea de ayuda tiene una opción de chat en thehotline.org.',
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
