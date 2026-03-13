import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Beaker, Download, Loader2, Trash2 } from 'lucide-react'
import { getEnsayoDetail, saveAndDownload, saveEnsayo } from '@/services/api'
import type { PhPayload } from '@/types'

const MODULE_TITLE = 'pH'
const FILE_PREFIX = 'PH'
const DRAFT_KEY = 'ph_form_draft_v2'
const DEBOUNCE_MS = 700
const SECADO_OPTIONS = ['', 'X'] as const
const REVISORES = ['-', 'FABIAN LA ROSA'] as const
const APROBADORES = ['-', 'IRMA COAQUIRA'] as const
const HORA_ROWS = Array.from({ length: 5 }, (_, i) => i)

const getCurrentYearShort = () => new Date().getFullYear().toString().slice(-2)
const formatTodayShortDate = () => {
    const d = new Date()
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear()).slice(-2)
    return `${dd}/${mm}/${yy}`
}

const normalizeMuestraCode = (raw: string): string => {
    const value = raw.trim().toUpperCase()
    if (!value) return ''
    const compact = value.replace(/\s+/g, '')
    const year = getCurrentYearShort()
    const match = compact.match(/^(\d+)(?:-[A-Z]+)?(?:-(\d{2}))?$/)
    return match ? `${match[1]}-${match[2] || year}` : value
}

const normalizeNumeroOtCode = (raw: string): string => {
    const value = raw.trim().toUpperCase()
    if (!value) return ''
    const compact = value.replace(/\s+/g, '')
    const year = getCurrentYearShort()
    const patterns = [/^(?:N?OT-)?(\d+)(?:-(\d{2}))?$/, /^(\d+)(?:-(?:N?OT))?(?:-(\d{2}))?$/]
    for (const pattern of patterns) {
        const match = compact.match(pattern)
        if (match) return `${match[1]}-${match[2] || year}`
    }
    return value
}

const normalizeFlexibleDate = (raw: string): string => {
    const value = raw.trim()
    if (!value) return ''
    const digits = value.replace(/\D/g, '')
    const year = getCurrentYearShort()
    const pad2 = (part: string) => part.padStart(2, '0').slice(-2)
    const build = (d: string, m: string, y: string = year) => `${pad2(d)}/${pad2(m)}/${pad2(y)}`

    if (value.includes('/')) {
        const [d = '', m = '', yRaw = ''] = value.split('/').map((part) => part.trim())
        if (!d || !m) return value
        let yy = yRaw.replace(/\D/g, '')
        if (yy.length === 4) yy = yy.slice(-2)
        if (yy.length === 1) yy = `0${yy}`
        if (!yy) yy = year
        return build(d, m, yy)
    }

    if (digits.length === 2) return build(digits[0], digits[1])
    if (digits.length === 3) return build(digits[0], digits.slice(1, 3))
    if (digits.length === 4) return build(digits.slice(0, 2), digits.slice(2, 4))
    if (digits.length === 5) return build(digits[0], digits.slice(1, 3), digits.slice(3, 5))
    if (digits.length === 6) return build(digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6))
    if (digits.length >= 8) return build(digits.slice(0, 2), digits.slice(2, 4), digits.slice(6, 8))

    return value
}

const parseNum = (value: string) => {
    if (value.trim() === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

const round = (value: number, decimals = 4) => {
    const factor = 10 ** decimals
    return Math.round(value * factor) / factor
}

const normalizeArray = <T,>(value: T[] | undefined, length: number, fallback: T): T[] => {
    const result = Array.from({ length }, () => fallback)
    if (!value) return result
    value.slice(0, length).forEach((item, idx) => {
        result[idx] = item
    })
    return result
}

const getEnsayoId = () => {
    const raw = new URLSearchParams(window.location.search).get('ensayo_id')
    const n = Number(raw)
    return Number.isInteger(n) && n > 0 ? n : null
}

type FormState = {
    muestra: string
    numero_ot: string
    fecha_ensayo: string
    realizado_por: string
    condicion_secado_aire: string
    condicion_secado_horno: string
    temperatura_ensayo_c: number | null
    ph_resultado: number | null
    recipiente_numero: string
    peso_recipiente_g: number | null
    peso_recipiente_suelo_humedo_g: number | null
    peso_recipiente_suelo_seco_g: number | null
    peso_agua_g: number | null
    peso_suelo_g: number | null
    contenido_humedad_pct: number | null
    hora_1: string[]
    deform_1: Array<number | null>
    hora_2: string[]
    deform_2: Array<number | null>
    hora_3: string[]
    deform_3: Array<number | null>
    revisado_por: string
    aprobado_por: string
}

const initialState = (): FormState => ({
    muestra: '',
    numero_ot: '',
    fecha_ensayo: '',
    realizado_por: '',
    condicion_secado_aire: '',
    condicion_secado_horno: '',
    temperatura_ensayo_c: null,
    ph_resultado: null,
    recipiente_numero: '',
    peso_recipiente_g: null,
    peso_recipiente_suelo_humedo_g: null,
    peso_recipiente_suelo_seco_g: null,
    peso_agua_g: null,
    peso_suelo_g: null,
    contenido_humedad_pct: null,
    hora_1: Array.from({ length: HORA_ROWS.length }, () => ''),
    deform_1: Array.from({ length: HORA_ROWS.length }, () => null),
    hora_2: Array.from({ length: HORA_ROWS.length }, () => ''),
    deform_2: Array.from({ length: HORA_ROWS.length }, () => null),
    hora_3: Array.from({ length: HORA_ROWS.length }, () => ''),
    deform_3: Array.from({ length: HORA_ROWS.length }, () => null),
    revisado_por: '-',
    aprobado_por: '-',
})

const hydrateForm = (payload?: Partial<PhPayload>): FormState => {
    const base = initialState()
    if (!payload) return base

    const revisado = typeof payload.revisado_por === 'string' && payload.revisado_por.trim()
        ? payload.revisado_por
        : base.revisado_por
    const aprobado = typeof payload.aprobado_por === 'string' && payload.aprobado_por.trim()
        ? payload.aprobado_por
        : base.aprobado_por

    return {
        ...base,
        ...payload,
        condicion_secado_aire: payload.condicion_secado_aire ?? base.condicion_secado_aire,
        condicion_secado_horno: payload.condicion_secado_horno ?? base.condicion_secado_horno,
        temperatura_ensayo_c: payload.temperatura_ensayo_c ?? base.temperatura_ensayo_c,
        ph_resultado: payload.ph_resultado ?? base.ph_resultado,
        hora_1: normalizeArray(payload.hora_1, HORA_ROWS.length, ''),
        deform_1: normalizeArray(payload.deform_1, HORA_ROWS.length, null),
        hora_2: normalizeArray(payload.hora_2, HORA_ROWS.length, ''),
        deform_2: normalizeArray(payload.deform_2, HORA_ROWS.length, null),
        hora_3: normalizeArray(payload.hora_3, HORA_ROWS.length, ''),
        deform_3: normalizeArray(payload.deform_3, HORA_ROWS.length, null),
        revisado_por: revisado,
        aprobado_por: aprobado,
    }
}

export default function ModuloForm() {
    const [form, setForm] = useState<FormState>(() => initialState())
    const [loading, setLoading] = useState(false)
    const [loadingEdit, setLoadingEdit] = useState(false)
    const [ensayoId, setEnsayoId] = useState<number | null>(() => getEnsayoId())

    useEffect(() => {
        const raw = localStorage.getItem(`${DRAFT_KEY}:${ensayoId ?? 'new'}`)
        if (!raw) return
        try {
            const parsed = JSON.parse(raw) as Partial<PhPayload>
            setForm(hydrateForm(parsed))
        } catch {
            localStorage.removeItem(`${DRAFT_KEY}:${ensayoId ?? 'new'}`)
        }
    }, [ensayoId])

    useEffect(() => {
        const t = window.setTimeout(() => {
            localStorage.setItem(`${DRAFT_KEY}:${ensayoId ?? 'new'}`, JSON.stringify(form))
        }, DEBOUNCE_MS)
        return () => window.clearTimeout(t)
    }, [form, ensayoId])

    useEffect(() => {
        if (!ensayoId) return
        let cancel = false
        const run = async () => {
            setLoadingEdit(true)
            try {
                const detail = await getEnsayoDetail(ensayoId)
                if (!cancel && detail.payload) {
                    setForm(hydrateForm(detail.payload))
                }
            } catch {
                toast.error('No se pudo cargar ensayo de pH.')
            } finally {
                if (!cancel) setLoadingEdit(false)
            }
        }
        void run()
        return () => {
            cancel = true
        }
    }, [ensayoId])

    const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((prev) => ({ ...prev, [key]: value }))
    }, [])

    const setArrayNumberField = useCallback(
        (key: 'deform_1' | 'deform_2' | 'deform_3', index: number, value: number | null) => {
            setForm((prev) => {
                const arr = [...prev[key]]
                arr[index] = value
                return { ...prev, [key]: arr }
            })
        },
        [],
    )

    const setArrayTextField = useCallback((key: 'hora_1' | 'hora_2' | 'hora_3', index: number, value: string) => {
        setForm((prev) => {
            const arr = [...prev[key]]
            arr[index] = value
            return { ...prev, [key]: arr }
        })
    }, [])

    const clearAll = useCallback(() => {
        if (!window.confirm('Se limpiaran los datos no guardados. Deseas continuar?')) return
        localStorage.removeItem(`${DRAFT_KEY}:${ensayoId ?? 'new'}`)
        setForm(initialState())
    }, [ensayoId])

    const computedPesoAgua = useMemo(() => {
        if (form.peso_recipiente_suelo_humedo_g == null || form.peso_recipiente_suelo_seco_g == null) return null
        return round(form.peso_recipiente_suelo_humedo_g - form.peso_recipiente_suelo_seco_g)
    }, [form.peso_recipiente_suelo_humedo_g, form.peso_recipiente_suelo_seco_g])

    const computedPesoSuelo = useMemo(() => {
        if (form.peso_recipiente_suelo_seco_g == null || form.peso_recipiente_g == null) return null
        return round(form.peso_recipiente_suelo_seco_g - form.peso_recipiente_g)
    }, [form.peso_recipiente_suelo_seco_g, form.peso_recipiente_g])

    const computedHumedad = useMemo(() => {
        if (computedPesoAgua == null || computedPesoSuelo == null || computedPesoSuelo === 0) return null
        return round((computedPesoAgua / computedPesoSuelo) * 100, 3)
    }, [computedPesoAgua, computedPesoSuelo])

    const save = useCallback(
        async (download: boolean) => {
            if (!form.muestra || !form.numero_ot || !form.fecha_ensayo) {
                toast.error('Complete Muestra, N OT y Fecha de ensayo.')
                return
            }
            setLoading(true)
            try {
                const payload: PhPayload = {
                    ...form,
                    peso_agua_g: form.peso_agua_g ?? computedPesoAgua,
                    peso_suelo_g: form.peso_suelo_g ?? computedPesoSuelo,
                    contenido_humedad_pct: form.contenido_humedad_pct ?? computedHumedad,
                }

                if (download) {
                    const blob = await saveAndDownload(payload, ensayoId ?? undefined)
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${FILE_PREFIX}_${form.numero_ot}_${new Date().toISOString().slice(0, 10)}.xlsx`
                    a.click()
                    URL.revokeObjectURL(url)
                } else {
                    await saveEnsayo(payload, ensayoId ?? undefined)
                }
                localStorage.removeItem(`${DRAFT_KEY}:${ensayoId ?? 'new'}`)
                setForm(initialState())
                setEnsayoId(null)
                if (window.parent !== window) window.parent.postMessage({ type: 'CLOSE_MODAL' }, '*')
                toast.success(download ? 'pH guardado y descargado.' : 'pH guardado.')
            } catch (err) {
                const msg = axios.isAxiosError(err)
                    ? err.response?.data?.detail || 'No se pudo generar pH.'
                    : 'No se pudo generar pH.'
                toast.error(msg)
            } finally {
                setLoading(false)
            }
        },
        [
            ensayoId,
            form,
            computedPesoAgua,
            computedPesoSuelo,
            computedHumedad,
        ],
    )

    const denseInputClass =
        'h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm transition focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/35'
    const readOnlyInputClass = 'h-8 w-full rounded-md border border-slate-200 bg-slate-100 px-2 text-sm text-slate-800'

    return (
        <div className="min-h-screen bg-slate-100 p-4 md:p-6">
            <div className="mx-auto max-w-[1100px] space-y-4">
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-slate-50">
                        <Beaker className="h-5 w-5 text-slate-900" />
                    </div>
                    <div>
                        <h1 className="text-base font-semibold text-slate-900 md:text-lg">{MODULE_TITLE.toUpperCase()}</h1>
                        <p className="text-xs text-slate-600">Replica del formato Excel oficial</p>
                    </div>
                </div>

                {loadingEdit ? (
                    <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-sm">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cargando ensayo...
                    </div>
                ) : null}

                <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
                    <div className="border-b border-slate-300 bg-slate-50 px-4 py-4 text-center">
                        <p className="text-[24px] font-semibold leading-tight text-slate-900">LABORATORIO DE ENSAYO DE MATERIALES</p>
                        <p className="text-lg font-semibold leading-tight text-slate-900">FORMATO N° F-LEM-P-SU-03.01</p>
                    </div>

                    <div className="border-b border-slate-300 bg-white px-3 py-3">
                        <table className="w-full table-fixed border border-slate-300 text-sm">
                            <thead className="bg-slate-100 text-xs font-semibold text-slate-800">
                                <tr>
                                    <th className="border-r border-slate-300 py-1" colSpan={2}>MUESTRA</th>
                                    <th className="border-r border-slate-300 py-1">N° OT</th>
                                    <th className="border-r border-slate-300 py-1" colSpan={2}>FECHA DE ENSAYO</th>
                                    <th className="py-1" colSpan={2}>REALIZADO</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className="border-r border-t border-slate-300 p-1" colSpan={2}>
                                        <input
                                            className={denseInputClass}
                                            value={form.muestra}
                                            onChange={(e) => setField('muestra', e.target.value)}
                                            onBlur={() => setField('muestra', normalizeMuestraCode(form.muestra))}
                                            autoComplete="off"
                                            data-lpignore="true"
                                        />
                                    </td>
                                    <td className="border-r border-t border-slate-300 p-1">
                                        <input
                                            className={denseInputClass}
                                            value={form.numero_ot}
                                            onChange={(e) => setField('numero_ot', e.target.value)}
                                            onBlur={() => setField('numero_ot', normalizeNumeroOtCode(form.numero_ot))}
                                            autoComplete="off"
                                            data-lpignore="true"
                                        />
                                    </td>
                                    <td className="border-r border-t border-slate-300 p-1" colSpan={2}>
                                        <input
                                            className={denseInputClass}
                                            value={form.fecha_ensayo}
                                            onChange={(e) => setField('fecha_ensayo', e.target.value)}
                                            onBlur={() => setField('fecha_ensayo', normalizeFlexibleDate(form.fecha_ensayo))}
                                            autoComplete="off"
                                            data-lpignore="true"
                                            placeholder="DD/MM/AA"
                                        />
                                    </td>
                                    <td className="border-t border-slate-300 p-1" colSpan={2}>
                                        <input
                                            className={denseInputClass}
                                            value={form.realizado_por}
                                            onChange={(e) => setField('realizado_por', e.target.value)}
                                            autoComplete="off"
                                            data-lpignore="true"
                                        />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="border-b border-slate-300 bg-slate-100 px-4 py-3 text-center">
                        <p className="text-[14px] font-semibold leading-tight text-slate-900">
                            MÉTODO DE ENSAYO NORMALIZADO PARA LA DETERMINACIÓN DEL VALOR PH EN SUELOS Y AGUA SUBTERRÁNEA
                        </p>
                        <p className="text-[13px] font-semibold text-slate-900">NORMA NTP 339.176</p>
                    </div>

                    <div className="p-3">
                        <div className="mb-4 w-full max-w-md overflow-hidden rounded-lg border border-slate-300">
                            <div className="border-b border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800 text-center">
                                CONDICIONES DE SECADO
                            </div>
                            <table className="w-full table-fixed text-sm">
                                <tbody>
                                    {[
                                        { label: 'SECADO AL AIRE', key: 'condicion_secado_aire' as const },
                                        { label: 'SECADO EN HORNO 60°C', key: 'condicion_secado_horno' as const },
                                    ].map((row) => (
                                        <tr key={row.key}>
                                            <td className="border-t border-r border-slate-300 px-2 py-1 text-xs">{row.label}</td>
                                            <td className="border-t border-slate-300 p-1 w-20">
                                                <select
                                                    className={denseInputClass}
                                                    value={form[row.key]}
                                                    onChange={(e) => setField(row.key, e.target.value)}
                                                >
                                                    {SECADO_OPTIONS.map((opt) => (
                                                        <option key={opt} value={opt}>
                                                            {opt}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="mb-4 overflow-hidden rounded-lg border border-slate-300">
                            <div className="border-b border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800 text-center">
                                RESULTADOS DE ENSAYO
                            </div>
                            <table className="w-full table-fixed text-sm">
                                <tbody>
                                    <tr>
                                        <td className="border-t border-r border-slate-300 px-2 py-1 text-xs">Temperatura de Ensayo</td>
                                        <td className="border-t border-r border-slate-300 px-2 py-1 text-center text-xs">(°C)</td>
                                        <td className="border-t border-slate-300 p-1">
                                            <input
                                                type="number"
                                                step="any"
                                                className={denseInputClass}
                                                value={form.temperatura_ensayo_c ?? ''}
                                                onChange={(e) => setField('temperatura_ensayo_c', parseNum(e.target.value))}
                                            />
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="border-t border-r border-slate-300 px-2 py-1 text-xs">PH</td>
                                        <td className="border-t border-r border-slate-300 px-2 py-1 text-center text-xs"></td>
                                        <td className="border-t border-slate-300 p-1">
                                            <input
                                                type="number"
                                                step="any"
                                                className={denseInputClass}
                                                value={form.ph_resultado ?? ''}
                                                onChange={(e) => setField('ph_resultado', parseNum(e.target.value))}
                                            />
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-4 rounded-lg border border-slate-300 p-2">
                            <div className="mb-2 text-center text-xs font-semibold text-slate-800">
                                CONTENIDO DE HUMEDAD - NTP 339.127
                            </div>
                            <table className="w-full table-fixed text-sm">
                                <colgroup>
                                    <col className="w-10" />
                                    <col />
                                    <col className="w-20" />
                                    <col className="w-44" />
                                </colgroup>
                                <tbody>
                                    {[
                                        {
                                            key: '1',
                                            label: 'N° del recipiente',
                                            unit: '',
                                            value: form.recipiente_numero,
                                            onChange: (value: string) => setField('recipiente_numero', value),
                                            type: 'text',
                                        },
                                        {
                                            key: '2',
                                            label: 'Peso del recipiente',
                                            unit: '(g)',
                                            value: form.peso_recipiente_g,
                                            onChange: (value: number | null) => setField('peso_recipiente_g', value),
                                        },
                                        {
                                            key: '3',
                                            label: 'peso del recipiente + Suelo humedo',
                                            unit: '(g)',
                                            value: form.peso_recipiente_suelo_humedo_g,
                                            onChange: (value: number | null) =>
                                                setField('peso_recipiente_suelo_humedo_g', value),
                                        },
                                        {
                                            key: '4',
                                            label: 'Peso de recipiente + suelo seco',
                                            unit: '(g)',
                                            value: form.peso_recipiente_suelo_seco_g,
                                            onChange: (value: number | null) => setField('peso_recipiente_suelo_seco_g', value),
                                        },
                                        {
                                            key: '5',
                                            label: 'Peso del agua  (3)-(4)',
                                            unit: '(g)',
                                            value: form.peso_agua_g ?? computedPesoAgua,
                                            readOnly: true,
                                        },
                                        {
                                            key: '6',
                                            label: 'peso del suelo (4)-(2)',
                                            unit: '(g)',
                                            value: form.peso_suelo_g ?? computedPesoSuelo,
                                            readOnly: true,
                                        },
                                        {
                                            key: '7',
                                            label: 'contenido de humedad (5)/(6) * 100',
                                            unit: '(%)',
                                            value: form.contenido_humedad_pct ?? computedHumedad,
                                            readOnly: true,
                                        },
                                    ].map((row) => (
                                        <tr key={row.key}>
                                            <td className="border-t border-r border-slate-300 px-2 py-1 text-xs text-center">
                                                {row.key}
                                            </td>
                                            <td className="border-t border-r border-slate-300 px-2 py-1 text-xs">{row.label}</td>
                                            <td className="border-t border-r border-slate-300 px-2 py-1 text-center text-xs">
                                                {row.unit}
                                            </td>
                                            <td className="border-t border-slate-300 p-1">
                                                {row.type === 'text' ? (
                                                    <input
                                                        className={denseInputClass}
                                                        value={row.value as string}
                                                        onChange={(e) => row.onChange?.(e.target.value)}
                                                    />
                                                ) : (
                                                    <input
                                                        type="number"
                                                        step="any"
                                                        className={row.readOnly ? readOnlyInputClass : denseInputClass}
                                                        value={(row.value as number | null) ?? ''}
                                                        onChange={(e) => {
                                                            if (row.readOnly) return
                                                            row.onChange?.(parseNum(e.target.value))
                                                        }}
                                                        readOnly={row.readOnly}
                                                    />
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-4 rounded-lg border border-slate-300">
                            <table className="w-full table-fixed text-sm">
                                <thead className="bg-slate-100 text-xs font-semibold text-slate-800">
                                    <tr>
                                        <th className="border-b border-r border-slate-300 py-1">Hora</th>
                                        <th className="border-b border-r border-slate-300 py-1">Deform. #1</th>
                                        <th className="border-b border-r border-slate-300 py-1">Hora</th>
                                        <th className="border-b border-r border-slate-300 py-1">Deform. #2</th>
                                        <th className="border-b border-r border-slate-300 py-1">Hora</th>
                                        <th className="border-b border-slate-300 py-1">Deform. #3</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {HORA_ROWS.map((rowIdx) => (
                                        <tr key={rowIdx}>
                                            <td className="border-t border-r border-slate-300 p-1">
                                                <input
                                                    className={denseInputClass}
                                                    value={form.hora_1[rowIdx]}
                                                    onChange={(e) => setArrayTextField('hora_1', rowIdx, e.target.value)}
                                                />
                                            </td>
                                            <td className="border-t border-r border-slate-300 p-1">
                                                <input
                                                    type="number"
                                                    step="any"
                                                    className={denseInputClass}
                                                    value={form.deform_1[rowIdx] ?? ''}
                                                    onChange={(e) => setArrayNumberField('deform_1', rowIdx, parseNum(e.target.value))}
                                                />
                                            </td>
                                            <td className="border-t border-r border-slate-300 p-1">
                                                <input
                                                    className={denseInputClass}
                                                    value={form.hora_2[rowIdx]}
                                                    onChange={(e) => setArrayTextField('hora_2', rowIdx, e.target.value)}
                                                />
                                            </td>
                                            <td className="border-t border-r border-slate-300 p-1">
                                                <input
                                                    type="number"
                                                    step="any"
                                                    className={denseInputClass}
                                                    value={form.deform_2[rowIdx] ?? ''}
                                                    onChange={(e) => setArrayNumberField('deform_2', rowIdx, parseNum(e.target.value))}
                                                />
                                            </td>
                                            <td className="border-t border-r border-slate-300 p-1">
                                                <input
                                                    className={denseInputClass}
                                                    value={form.hora_3[rowIdx]}
                                                    onChange={(e) => setArrayTextField('hora_3', rowIdx, e.target.value)}
                                                />
                                            </td>
                                            <td className="border-t border-slate-300 p-1">
                                                <input
                                                    type="number"
                                                    step="any"
                                                    className={denseInputClass}
                                                    value={form.deform_3[rowIdx] ?? ''}
                                                    onChange={(e) => setArrayNumberField('deform_3', rowIdx, parseNum(e.target.value))}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="rounded-lg border border-slate-300 bg-white p-2">
                                <div className="mb-2 text-center text-xs font-semibold text-slate-800">Realizado</div>
                                <input
                                    className={denseInputClass}
                                    value={form.realizado_por}
                                    onChange={(e) => setField('realizado_por', e.target.value)}
                                />
                            </div>
                            <div className="rounded-lg border border-slate-300 bg-white p-2">
                                <div className="mb-2 text-center text-xs font-semibold text-slate-800">Revisado</div>
                                <select
                                    className={denseInputClass}
                                    value={form.revisado_por}
                                    onChange={(e) => setField('revisado_por', e.target.value)}
                                >
                                    {REVISORES.map((opt) => (
                                        <option key={opt} value={opt}>
                                            {opt}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="rounded-lg border border-slate-300 bg-white p-2">
                                <div className="mb-2 text-center text-xs font-semibold text-slate-800">Aprobado</div>
                                <select
                                    className={denseInputClass}
                                    value={form.aprobado_por}
                                    onChange={(e) => setField('aprobado_por', e.target.value)}
                                >
                                    {APROBADORES.map((opt) => (
                                        <option key={opt} value={opt}>
                                            {opt}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                            <button
                                onClick={clearAll}
                                disabled={loading}
                                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white font-medium text-slate-900 shadow-sm transition hover:bg-slate-100 disabled:opacity-50"
                            >
                                <Trash2 className="h-4 w-4" />
                                Limpiar todo
                            </button>
                            <button
                                onClick={() => void save(false)}
                                disabled={loading}
                                className="h-11 rounded-lg border border-slate-900 bg-white font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100 disabled:opacity-50"
                            >
                                {loading ? 'Guardando...' : 'Guardar'}
                            </button>
                            <button
                                onClick={() => void save(true)}
                                disabled={loading}
                                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-emerald-700 bg-emerald-700 font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Procesando...
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-4 w-4" />
                                        Guardar y Descargar
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
