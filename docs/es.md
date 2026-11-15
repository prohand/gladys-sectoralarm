# Sector Alarm

Esta integración conecta Gladys con su sistema de alarma **Sector Alarm**:
armar y desarmar la central, cerrar y abrir las cerraduras inteligentes,
encender y apagar los enchufes inteligentes, y seguir los sensores (puertas y
ventanas, humo, fugas de agua, temperatura, humedad).

## Antes de empezar

- Se necesita **Gladys 5.3 o posterior**.
- Una **cuenta Sector Alarm**: el correo y la contraseña de la app móvil
  Sector Alarm.
- Gladys necesita **acceso a Internet**. Sector Alarm no tiene API local: todo
  pasa por la nube de Sector Alarm (`mypagesapi.sectoralarm.net`). Por eso la
  integración lleva la etiqueta **cloud**.

## Configuración

| Campo                              | Qué poner                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Correo electrónico**             | El correo de su cuenta Sector Alarm.                                                                                                           |
| **Contraseña**                     | Su contraseña. Guardada como secreto, nunca escrita en los registros.                                                                          |
| **Código de la central**           | El código que teclea en el teclado. Opcional, vea más abajo.                                                                                   |
| **Identificador de la central**    | Vacío para seguir todas las centrales de la cuenta. Si no, un identificador, o varios separados por comas.                                     |
| **Intervalo de actualización (s)** | Frecuencia de lectura de Sector Alarm. 60 s por defecto, 30 s como mínimo. Sector Alarm limita las peticiones: bajar de un minuto aporta poco. |

Guarde y pulse **Probar la conexión**: la respuesta lista las centrales
encontradas, su modo, si están en línea y cuántos accesorios tienen. Después
abra la pestaña **Descubrimiento** de la integración y cree los dispositivos
que desee.

### El código de la central

El código **solo** se necesita para:

- desarmar la alarma desde Gladys (una escena, la tarjeta del dispositivo);
- cerrar o abrir una cerradura inteligente;
- armar una central cuyo **armado rápido** está desactivado.

Sin código, Gladys puede leerlo todo y armar una central con el armado rápido
activado. Déjelo vacío si no quiere que Gladys pueda desarmar.

## Dispositivos

| Dispositivo en Gladys          | Funciones                                                 | Valores                        |
| ------------------------------ | --------------------------------------------------------- | ------------------------------ |
| **Central** (una por central)  | Modo de la alarma (una lista: Desarmada, Parcial, Armada) | `disarmed`, `partial`, `armed` |
| **Cerradura inteligente**      | Cerradura (controlable), Batería baja                     | 1 = cerrada, 0 = abierta       |
| **Enchufe inteligente**        | Alimentación (controlable)                                | 1 = encendido, 0 = apagado     |
| **Sensor de puerta / ventana** | Apertura, Batería baja                                    | 1 = cerrada, 0 = abierta       |
| **Detector de humo**           | Humo, a menudo Temperatura                                | 1 = humo detectado             |
| **Detector de fugas**          | Fuga de agua                                              | 1 = fuga detectada             |
| **Temperatura / humedad**      | Temperatura (°C), Humedad (%)                             |                                |

El modo «parcial» solo aparece en una central que lo permite. Cada dispositivo
muestra una insignia **cloud**; pasa a **inaccesible** cuando la central está
sin conexión o Sector Alarm no responde.

Gladys no consulta los dispositivos uno por uno: la integración lee cada
central entera, al intervalo elegido, y solo envía a Gladys los valores que han
cambiado. Tras una orden, la central se vuelve a leer unos segundos después
para confirmarla.

## Widget del panel

Añada el widget **Sector Alarm** a un panel. Muestra:

- el modo de la alarma (rojo armada, naranja parcial, verde desarmada);
- la conexión de la central;
- las puertas y ventanas abiertas, las cerraduras abiertas;
- una alerta de humo o de agua.

Sus botones: **Armar** y **Parcial** (con confirmación), **Desarmar**,
**Actualizar**.

> **Seguridad.** Un panel puede estar colgado en la pared y cualquiera puede
> pulsarlo. Por eso el botón **Desarmar** **nunca** usa el código de la
> configuración: abre un pequeño formulario donde hay que teclear el código
> cada vez.

Con varias centrales, elija la que se muestra en los ajustes del widget.

## Escenas

### Disparadores

| Disparador                               | Clave                      | Filtros                  | Variables                                                                    |
| ---------------------------------------- | -------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| **Cambia el modo de la alarma**          | `alarm_mode_changed`       | Central, Nuevo modo      | `mode`, `previous_mode`, `panel_name`, `user`, `channel`                     |
| **Una central se desconecta o vuelve**   | `panel_connection_changed` | Central, Conexión        | `state` (`offline` / `online`), `panel_name`                                 |
| **Se acciona una cerradura inteligente** | `lock_operated`            | Cerradura, Qué ha pasado | `action` (`lock` / `unlock` / `lock_failed`), `lock_name`, `user`, `channel` |

`user` y `channel` vienen del registro de eventos de Sector Alarm (quién, y con
qué: teclado, app, llavero…); están vacíos cuando el registro no lo indica.

Los disparadores saltan con los **cambios** vistos entre dos lecturas, vengan de
donde vengan (teclado, app, llavero o Gladys). Nada salta en la primera lectura
tras un arranque: el historial no es una novedad. Un cambio que va y viene
entre dos lecturas puede perderse: baje el intervalo si es importante.

Ejemplos:

- _Cuando se desarme la alarma, si no hay nadie en casa, enviarme una
  notificación con `{{triggerEvent.data.user}}`._
- _Cuando la central se desconecte, enviar un mensaje._
- _Cuando se abra la cerradura de la entrada, encender la luz del recibidor._

### Acciones

| Acción                           | Clave            | Campos             | Salidas                            |
| -------------------------------- | ---------------- | ------------------ | ---------------------------------- |
| **Cambiar el modo de la alarma** | `set_alarm_mode` | Central, Modo      | `applied` (sí/no), `mode`, `error` |
| **Leer Sector Alarm ahora**      | `refresh_now`    | Central (opcional) | `mode`, `online`                   |

`set_alarm_mode` usa el código de la central de la configuración. Una orden
rechazada no detiene la escena: compruebe `applied` en una condición y use
`error` en una notificación. Ejemplo: _a las 23 h, armar la alarma en parcial;
si `applied` es no, enviarme `error`._

Las acciones estándar de Gladys también controlan los dispositivos: el modo de
la alarma, las cerraduras y los enchufes se ajustan con **Controlar un
dispositivo**.

## Botones de la pantalla de configuración

- **Probar la conexión**: vuelve a iniciar sesión y lee cada central.
- **Actualizar ahora**: lee Sector Alarm sin esperar.

## Solución de problemas

| Lo que ve                                        | Qué hacer                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| «Sector Alarm rechaza el correo o la contraseña» | Compruébelos en la app Sector Alarm y vuelva a guardar.                                                                         |
| «Sector Alarm pide reducir el ritmo»             | Sector Alarm limita las peticiones. La integración espacia sus lecturas y luego vuelve a la normalidad. Aumente el intervalo.   |
| «No se puede contactar con Sector Alarm»         | Compruebe el acceso a Internet de Gladys.                                                                                       |
| «Esta orden necesita el código de la central»    | Indique el código, o arme solo con el armado rápido.                                                                            |
| Falta un sensor                                  | Pulse **Actualizar ahora** y mire la pestaña **Descubrimiento**: allí aparece el nuevo accesorio.                               |
| El modo no cambia durante un corte               | Es a propósito: una central sin conexión dice estar «armada» pase lo que pase, así que Gladys conserva el último modo conocido. |

## Privacidad

Su correo, su contraseña y su código se quedan en Gladys, como secretos, y solo
se envían a Sector Alarm (`mypagesapi.sectoralarm.net`). La integración no usa
ningún otro servicio.

Esta integración no está hecha ni respaldada por Sector Alarm. Usa la misma API
que la app Sector Alarm, que puede cambiar sin previo aviso.
