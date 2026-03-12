export type PhPayload = {
    muestra: string
    numero_ot: string
    fecha_ensayo: string
    realizado_por?: string
    condicion_secado_aire?: string
    condicion_secado_horno?: string
    temperatura_ensayo_c?: number | null
    ph_resultado?: number | null
    recipiente_numero?: string
    peso_recipiente_g?: number | null
    peso_recipiente_suelo_humedo_g?: number | null
    peso_recipiente_suelo_seco_g?: number | null
    peso_agua_g?: number | null
    peso_suelo_g?: number | null
    contenido_humedad_pct?: number | null
    hora_1?: string[]
    deform_1?: Array<number | null>
    hora_2?: string[]
    deform_2?: Array<number | null>
    hora_3?: string[]
    deform_3?: Array<number | null>
    observaciones?: string
    equipo_horno_codigo?: string
    equipo_balanza_001_codigo?: string
    equipo_ph_metro_codigo?: string
    revisado_por?: string
    aprobado_por?: string
    [key: string]: unknown
}

export type ModuloPayload = PhPayload

export type EnsayoDetail = {
    id: number
    numero_ensayo?: string | null
    numero_ot?: string | null
    cliente?: string | null
    muestra?: string | null
    fecha_documento?: string | null
    estado?: string | null
    payload?: PhPayload | null
}

export type SaveResponse = {
    id: number
    numero_ensayo: string
    numero_ot: string
    estado: string
}
