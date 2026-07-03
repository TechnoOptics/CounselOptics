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
    slug: 'acuerdo-de-confidencialidad',
    enSlug: 'nda',
    title: 'Modelo de Acuerdo de Confidencialidad (NDA)',
    oneLine:
      'Un acuerdo de confidencialidad mutuo protege la información confidencial que comparten dos partes. Úsalo para conversaciones de negocios donde ambas partes compartirán información sensible (una propuesta de venta, la revisión de un inversionista, la evaluación de un proveedor).',
    category: 'Contratos',
    lastReviewed: '2026-06-08',
    context:
      'Usa un Acuerdo de Confidencialidad antes de cualquier conversación de negocios donde una o ambas partes compartirán información confidencial que no quieres hacer pública: hojas de ruta técnicas, listas de clientes, código fuente, cifras financieras, productos no lanzados. Este es un acuerdo mutuo, protege a ambas partes. Para un acuerdo unilateral (una parte comparte, la otra recibe) tendrías que eliminar el lenguaje mutuo e identificar cuál parte es la que Divulga.',
    warnings: [
      'Los acuerdos de confidencialidad no cubren información que se vuelve pública por sí sola, que ya era conocida por la parte receptora, o que la parte receptora desarrolla de forma independiente.',
      'Suelen tener una duración fija (de 1 a 5 años es común). Los acuerdos perpetuos son difíciles de hacer cumplir.',
      'Los secretos comerciales tienen protección separada y más fuerte bajo la ley federal de secretos comerciales y las leyes estatales. Un acuerdo de confidencialidad no sustituye buenas prácticas de protección de secretos comerciales.',
      'No pueden impedir que alguien reporte un delito, acoso, o una violación de valores. Muchos estados tienen excepciones explícitas.',
    ],
    body: `ACUERDO MUTUO DE CONFIDENCIALIDAD

Este Acuerdo Mutuo de Confidencialidad (el "Acuerdo") se celebra el {{Fecha de Entrada en Vigor}} (la "Fecha de Entrada en Vigor") entre:

{{Nombre de la Parte A}}, una {{tipo de entidad, ej. "sociedad de responsabilidad limitada"}} de {{estado}} ubicada en {{dirección}} ("Parte A"), y

{{Nombre de la Parte B}}, una {{tipo de entidad}} de {{estado}} ubicada en {{dirección}} ("Parte B").

Cada parte puede denominarse una "Parte" y, en conjunto, las "Partes".

1. PROPÓSITO. Las Partes desean explorar una posible {{describe el propósito, ej. "relación de negocios relacionada con un acuerdo de licencia de software"}} (el "Propósito"). En relación con el Propósito, cada Parte podrá divulgar a la otra información confidencial.

2. INFORMACIÓN CONFIDENCIAL. "Información Confidencial" significa cualquier información no pública, en cualquier forma, que una Parte identifique como confidencial o que una persona razonable entendería como confidencial dadas las circunstancias, incluyendo pero sin limitarse a: datos técnicos, secretos comerciales, conocimientos, investigación, planes de producto, listas de clientes, software, código fuente, información financiera, estrategias de negocio y precios.

3. EXCLUSIONES. La Información Confidencial no incluye información que: (a) era de conocimiento público al momento de la divulgación; (b) se vuelve de conocimiento público sin culpa de la parte receptora; (c) ya estaba en posesión de la parte receptora antes de la divulgación; (d) es desarrollada de forma independiente por la parte receptora sin referencia a la Información Confidencial de la parte divulgadora; o (e) se obtiene legítimamente de un tercero sin incumplir una obligación de confidencialidad.

4. OBLIGACIONES. Cada Parte se compromete a: (a) mantener en estricta confidencialidad la Información Confidencial de la otra Parte; (b) usar la Información Confidencial únicamente para el Propósito; (c) limitar la divulgación a sus empleados, contratistas y asesores que tengan necesidad de conocerla y que estén sujetos a obligaciones de confidencialidad al menos tan protectoras como las de este Acuerdo; y (d) proteger la Información Confidencial con al menos el mismo grado de cuidado que usa para proteger su propia información confidencial, pero no menos que un cuidado razonable.

5. VIGENCIA. Este Acuerdo comienza en la Fecha de Entrada en Vigor y continúa por {{duración, ej. "tres (3) años"}}, tras lo cual las obligaciones de confidencialidad subsisten por {{duración adicional, ej. "dos (2) años"}} adicionales desde la fecha de la última divulgación.

6. DEVOLUCIÓN O DESTRUCCIÓN. Ante solicitud por escrito, la parte receptora devolverá o destruirá con prontitud toda la Información Confidencial de la parte divulgadora que tenga en su poder, salvo lo que deba conservar por ley o por sus políticas internas de retención de registros.

7. SIN LICENCIA. Nada en este Acuerdo otorga a ninguna Parte ningún derecho o licencia sobre la Información Confidencial, propiedad intelectual o tecnología de la otra Parte.

8. DIVULGACIONES PERMITIDAS. Nada en este Acuerdo impide que cualquiera de las Partes: (a) reporte una violación de la ley a una agencia gubernamental; (b) participe en una investigación gubernamental; o (c) cumpla con una citación o una orden judicial válida, siempre que la parte receptora notifique con prontitud a la parte divulgadora cuando la ley lo permita.

9. SIN GARANTÍA. Toda la Información Confidencial se proporciona "TAL CUAL". Ninguna Parte garantiza la exactitud o integridad de su Información Confidencial.

10. LEY APLICABLE. Este Acuerdo se rige por las leyes del Estado de {{estado}}, sin considerar sus principios de conflicto de leyes.

11. MEDIDAS CAUTELARES. Las Partes reconocen que el incumplimiento de este Acuerdo puede causar un daño irreparable y que la parte que no incumpla tiene derecho a solicitar medidas cautelares además de cualquier otro remedio disponible.

12. ACUERDO COMPLETO. Este Acuerdo constituye el acuerdo completo entre las Partes sobre su materia y sustituye todos los acuerdos previos sobre el mismo tema. Cualquier modificación debe hacerse por escrito y firmada por ambas Partes.

EN FE DE LO CUAL, las Partes han firmado este Acuerdo en la Fecha de Entrada en Vigor.

PARTE A:

Por: ______________________________
Nombre: {{nombre}}
Cargo: {{cargo}}
Fecha: ____________

PARTE B:

Por: ______________________________
Nombre: {{nombre}}
Cargo: {{cargo}}
Fecha: ____________`,
    keywords: [
      'modelo de acuerdo de confidencialidad',
      'nda en español',
      'acuerdo de confidencialidad mutuo',
      'nda gratis en español',
      'contrato de confidencialidad',
    ],
  },
  {
    slug: 'carta-de-cese-y-desista',
    enSlug: 'cease-and-desist',
    title: 'Modelo de Carta de Cese y Desista',
    oneLine:
      'Una carta de cese y desista le dice formalmente a alguien que detenga una acción dañina específica y le advierte de las consecuencias legales si continúa. Usos comunes: infracción de marca, acoso, difamación, infracción de derechos de autor.',
    category: 'Antes de litigar',
    lastReviewed: '2026-06-08',
    context:
      'Envía una carta de cese y desista cuando alguien está haciendo activamente algo dañino (usando tu marca, copiando tu trabajo, acosándote, difamándote) y quieres que se detenga antes de escalar a un litigio. La carta crea un registro documental que demuestra que la otra parte fue notificada, lo cual importa para probar intencionalidad más adelante y para obtener daños agravados en algunas áreas del derecho.',
    warnings: [
      'Ten un reclamo legal real antes de enviarla. Una carta de cese y desista sin fundamento puede constituir interferencia dolosa o, en algunos estados, litigio abusivo.',
      'Para asuntos de marca o derechos de autor, envíala a través de un abogado si es posible - una carta firmada por un abogado se toma más en serio y evita admisiones accidentales.',
      'No envíes amenazas que no estés dispuesto a cumplir.',
      'En situaciones domésticas (acoso, ex pareja), una carta de cese y desista rara vez es suficiente por sí sola. Considera una orden de protección a través de tu tribunal, y llama al 1-800-799-7233 para apoyo.',
    ],
    body: `{{Tu Nombre Completo o Nombre del Abogado y Despacho}}
{{Dirección}}
{{Ciudad, Estado, Código Postal}}
{{Correo Electrónico}}
{{Teléfono}}

{{Fecha}}

Vía Correo Certificado con Acuse de Recibo y Correo Electrónico

{{Nombre del Destinatario}}
{{Dirección del Destinatario}}
{{Ciudad, Estado, Código Postal}}

Re: CESE Y DESISTA - {{breve descripción del daño, ej. "Uso No Autorizado de [Marca]"}}

Estimado(a) {{Destinatario}}:

Esta carta se escribe en nombre de {{tu nombre o el de tu negocio}} en relación con {{describe la conducta dañina, ej. "su uso no autorizado de la marca ACME™ en su tienda en línea en example.com"}}.

Los Hechos:
1. {{Hecho específico #1 - fechas, URLs, capturas de pantalla, declaraciones de testigos según corresponda.}}
2. {{Hecho específico #2.}}
3. {{Hecho específico #3, incluyendo cómo la conducta le causa daño o viola sus derechos.}}

El Derecho:
Su conducta constituye {{la violación legal, ej. "infracción de marca registrada"}}. {{Breve explicación de una línea de por qué viola esa ley.}}

Demanda:
Por la presente se le exige que de inmediato:

1. CESE todo uso de {{describe qué debe detener, ej. "la marca ACME™ en cualquier forma, en cualquier publicidad, en cualquier producto, y en cualquier plataforma digital"}};
2. RETIRE todo material infractor dentro de {{fecha límite, ej. "siete (7) días"}} a partir de la fecha de esta carta, incluyendo pero sin limitarse a {{artículos específicos}};
3. PROPORCIONE confirmación por escrito del cumplimiento al abajo firmante antes del {{fecha límite}};
4. {{Demanda adicional si aplica, ej. "rinda cuentas y entregue cualquier ganancia derivada de la conducta infractora"}}.

Consecuencias:
Si no cumple con la fecha límite anterior, procederé con todos los recursos legales disponibles, incluyendo pero sin limitarse a presentar una demanda en {{jurisdicción}} solicitando medidas cautelares, daños estatutarios de hasta {{monto estatutario}}, honorarios de abogado y costos. {{Si aplica: "Ya he contratado a un abogado y autorizado la preparación de una demanda."}}

Esta carta constituye notificación formal de {{la violación}}. También constituye evidencia de intencionalidad si este asunto llega a litigio.

Nada en esta carta constituye una renuncia a ningún derecho o remedio, todos los cuales quedan expresamente reservados.

Actúe en consecuencia.

Atentamente,

{{Firma}}
{{Nombre en Letra de Molde}}

cc: {{cualquier otro destinatario, ej. abogado o agencia relevante}}`,
    keywords: [
      'modelo de carta de cese y desista',
      'carta de cese y desista gratis',
      'cese y desista marca registrada',
      'ejemplo de carta de cese y desista',
      'cómo escribir una carta de cese y desista',
    ],
  },
  {
    slug: 'aviso-de-terminacion-de-arrendamiento',
    enSlug: 'lease-termination-notice',
    title: 'Modelo de Aviso de Terminación de Arrendamiento',
    oneLine:
      'Aviso formal por escrito de que tú (el inquilino o el arrendador) intenta terminar un contrato de arrendamiento. La mayoría de los estados exigen un aviso por escrito con un tiempo de anticipación específico (usualmente 30, 60 o 90 días).',
    category: 'Relación arrendador-inquilino',
    lastReviewed: '2026-06-08',
    context:
      'Usa un aviso de terminación de arrendamiento cuando quieras terminar un arrendamiento mes a mes, un contrato de plazo fijo que permite terminación anticipada, o un arrendamiento donde la otra parte incumplió. El período de aviso lo determina la ley estatal y (a veces) el propio contrato: 30 días es el mínimo más común, pero varios estados exigen 60 o 90 días. Siempre envíalo por un método que genere un registro de entrega (correo certificado, entrega en persona con testigo, o un método electrónico permitido por el estado).',
    warnings: [
      'Los períodos de aviso varían por estado. California exige 60 días para arrendamientos de más de un año; Nueva York exige 30, 60 o 90 días según la duración del arrendamiento.',
      'Las protecciones de "causa justa" para el desalojo en California, Oregón, Nueva York y muchas ciudades limitan cuándo un arrendador puede notificar una terminación sin causa.',
      'Si eres inquilino y terminas durante un contrato de plazo fijo, podrías deber renta hasta el final del contrato a menos que tu estado tenga una ley de terminación anticipada o tu contrato lo permita.',
      'Los militares en servicio activo tienen protecciones adicionales bajo la ley federal que les permite terminar el arrendamiento anticipadamente.',
    ],
    body: `{{Tu Nombre}}
{{Tu Dirección}}
{{Tu Ciudad, Estado, Código Postal}}
{{Fecha}}

Vía Correo Certificado y Correo Electrónico

{{Nombre de la Otra Parte}}
{{Dirección de la Otra Parte}}
{{Ciudad, Estado, Código Postal de la Otra Parte}}

AVISO DE {{TERMINACIÓN / DESOCUPACIÓN}} DE ARRENDAMIENTO

Re: {{Dirección de la Propiedad en Renta}}

Estimado(a) {{Otra Parte}}:

De conformidad con los términos del contrato de arrendamiento de fecha {{fecha del contrato}} (el "Contrato") y {{estatuto estatal relevante}}, esta carta sirve como aviso formal de que {{especifica: "yo, el inquilino, tengo la intención de desocupar" O "el arrendamiento está siendo terminado"}} la propiedad ubicada en {{dirección de la propiedad en renta}} (la "Propiedad").

La fecha efectiva de terminación será el {{fecha - cuenta los días de aviso desde la entrega, ej. "treinta (30) días a partir de la recepción de este aviso, no antes del 15 de abril de 2026"}}. {{Si es mes a mes: "Este es al menos el aviso mínimo exigido por la ley estatal y por el Contrato."}}

{{Si el inquilino termina}}
Devolveré la posesión de la Propiedad antes del {{fecha de mudanza}}. La Propiedad será devuelta en las mismas condiciones en que la recibí, salvo el desgaste normal. Proporcionaré una dirección de reenvío para la devolución del depósito de seguridad:

{{Dirección de Reenvío}}

Por favor devuelva el depósito de seguridad por la cantidad de {{monto del depósito}} antes del {{fecha límite exigida por el estado, ej. "veintiún (21) días a partir de la fecha de mudanza"}}. Cualquier deducción debe estar detallada por escrito según lo exige {{estatuto estatal}}.

{{Si el arrendador termina}}
Debe desocupar la Propiedad antes del {{fecha de mudanza}}. Por favor devuelva todas las llaves, controles de garaje y tarjetas de acceso. Realizaré una inspección de mudanza el {{fecha}}; por favor contácteme al {{teléfono o correo}} para estar presente. Su depósito de seguridad será devuelto, menos cualquier deducción legal detallada por escrito, dentro de {{plazo exigido por el estado}} según lo exige {{estatuto estatal}}.

{{Motivo de la terminación, si aplica - algunos estados exigen indicar un motivo para terminaciones iniciadas por el arrendador.}}

Atentamente,

{{Firma}}
{{Nombre en Letra de Molde}}

cc: {{cualquier otra parte relevante, ej. co-inquilino, administrador de la propiedad, o abogado}}`,
    keywords: [
      'aviso de terminación de arrendamiento',
      'aviso de 30 días para desocupar en español',
      'cómo terminar un contrato de renta',
      'aviso de terminación de arrendamiento en español',
      'carta de terminación de arrendamiento gratis',
    ],
  },
  {
    slug: 'demanda-de-deposito-de-seguridad',
    enSlug: 'security-deposit-demand',
    title: 'Modelo de Demanda de Devolución de Depósito de Seguridad',
    oneLine:
      'Carta de demanda formal para la devolución de un depósito de seguridad que no fue reembolsado dentro del plazo legal de tu estado. La mayoría de los estados imponen daños de 2 a 3 veces el monto a los arrendadores que lo retienen indebidamente.',
    category: 'Relación arrendador-inquilino',
    lastReviewed: '2026-06-08',
    context:
      'Usa esta carta cuando te mudaste, diste una dirección de reenvío, y el arrendador no te devolvió el depósito de seguridad dentro del plazo exigido por el estado (típicamente de 14 a 60 días). La mayoría de los estados imponen daños estatutarios de 2 o 3 veces el monto retenido indebidamente, además de honorarios de abogado en algunas jurisdicciones. Envíala por correo certificado con acuse de recibo - la prueba de entrega importa para el tribunal de reclamos menores.',
    warnings: [
      'Confirma el plazo y los daños de tu estado antes de escribir la carta. California: plazo de devolución de 21 días, daños estatutarios de hasta 2 veces. Texas: 30 días, daños de $100 más 3 veces la porción retenida indebidamente. Nueva York: 14 días, daños de 2 veces.',
      'Algunos estados exigen que el arrendador detalle las deducciones por escrito dentro del mismo plazo; no hacerlo le hace perder el derecho a retener el depósito.',
      'Guarda copias del contrato, fotos de las condiciones al mudarte, la inspección de entrada, y la carta de dirección de reenvío como pruebas.',
      'Si la propiedad era de varias unidades y el arrendador no mantuvo el depósito en una cuenta separada (algunos estados lo exigen), esa es una defensa adicional y una infracción adicional.',
    ],
    body: `{{Tu Nombre Completo}}
{{Tu Dirección Actual}}
{{Tu Ciudad, Estado, Código Postal}}
{{Tu Correo Electrónico}}
{{Tu Teléfono}}

{{Fecha}}

Vía Correo Certificado con Acuse de Recibo y Correo Electrónico

{{Nombre Completo del Arrendador o Empresa Administradora}}
{{Dirección del Arrendador}}
{{Ciudad, Estado, Código Postal del Arrendador}}

Re: Demanda de Devolución de Depósito de Seguridad - {{Dirección de la Propiedad en Renta}}

Estimado(a) {{Nombre del Arrendador}}:

Renté la propiedad ubicada en {{dirección de renta}} desde {{fecha de inicio del contrato}} hasta {{fecha de mudanza}}. Pagué un depósito de seguridad de {{monto del depósito}} al inicio del arrendamiento. Le proporcioné mi dirección de reenvío por escrito el {{fecha de la dirección de reenvío}}.

Bajo {{estatuto estatal relevante}}, usted estaba obligado a devolver mi depósito de seguridad (o proporcionar una lista detallada por escrito de las deducciones) dentro de {{plazo exigido por el estado, ej. "21 días"}} a partir de la entrega de la posesión. Ese plazo venció el {{fecha límite}}. A la fecha de esta carta, he recibido {{se ha retenido el monto completo O "solo un monto parcial de $X sin desglose"}}.

Exijo la devolución de la porción retenida indebidamente de mi depósito de seguridad, por la cantidad de {{monto retenido}}, dentro de catorce (14) días a partir de la fecha de esta carta.

Su retención indebida lo hace sujeto a:

1. Devolución del monto completo de la porción retenida indebidamente: {{monto}};
2. Daños estatutarios de hasta {{multiplicador y monto específico del estado}}; y
3. {{Si aplica}} Honorarios de abogado si el asunto llega a los tribunales.

Demanda total: {{total = monto retenido + daños estatutarios}}.

Si no devuelve los montos exigidos antes del {{fecha límite}}, presentaré una demanda en {{tribunal de reclamos menores}}, donde la recuperación máxima es de hasta {{máximo de reclamos menores del estado}}. Ya he preparado los documentos necesarios y los presentaré de inmediato al vencer este plazo.

Por favor envíe el pago por cheque a la dirección de arriba o por transferencia a {{cuenta que termina en los últimos 4 dígitos}}.

Atentamente,

{{Firma}}
{{Nombre en Letra de Molde}}

Anexos:
- Copia del contrato de arrendamiento
- Inspección y fotos de entrada
- Inspección y fotos de mudanza
- Notificación de dirección de reenvío (con fecha)
- Cualquier correspondencia previa sobre el depósito`,
    keywords: [
      'demanda de devolución de depósito de seguridad',
      'el arrendador no devolvió mi depósito',
      'depósito de seguridad reclamos menores',
      'demanda por depósito de seguridad en español',
      'cómo demandar por el depósito de seguridad',
    ],
  },
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
