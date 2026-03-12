# Branding Iframes - PH

Documento de referencia para mantener consistente el branding del microfrontend de **PH** y su visualizacion embebida en iframe dentro del CRM.

## Alcance

- Microfrontend: `ph-crm`
- Shell embebedor: `crm-geofal` modulo PH
- Flujo: CRM abre `https://ph.geofal.com.pe` en dialog modal con `token` y opcionalmente `ensayo_id`

## Reglas visuales

- Mantener estructura de hoja tecnica fiel a la plantilla oficial del laboratorio.
- Mantener consistencia visual con modulos recientes de laboratorio.
- Botonera final con acciones `Guardar` y `Guardar y Descargar`.

## Contrato iframe

- Entrada por query params: `token`, `ensayo_id`.
- Mensajes hijo -> padre: `TOKEN_REFRESH_REQUEST`, `CLOSE_MODAL`.
- Mensaje padre -> hijo: `TOKEN_REFRESH`.
