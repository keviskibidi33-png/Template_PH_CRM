import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Beaker, Download, Loader2, Trash2 } from 'lucide-react'
import { getEnsayoDetail, saveAndDownload, saveEnsayo } from '@/services/api'
import type { PhPayload } from '@/types'
import FormatConfirmModal from '../components/FormatConfirmModal'


const buildFormatPreview = (sampleCode: string | undefined, materialCode: 'SU' | 'AG', ensayo: string) => {
    const currentYear = new Date().getFullYear().toString().slice(-2)
    const normalized = (sampleCode || '').trim().toUpperCase()
    const fullMatch = normalized.match(/^(\d+)(?:-[A-Z0-9. ]+)?-(\d{2,4})$/)
    const partialMatch = normalized.match(/^(\d+)(?:-(\d{2,4}))?$/)
    const match = fullMatch || partialMatch
    const numero = match?.[1] || 'xxxx'
    const year = (match?.[2] || currentYear).slice(-2)
    return `Formato N-${numero}-${materialCode}-${year} ${ensayo}`
}


const MODULE_TITLE = 'pH'
const FILE_PREFIX = 'PH'
const DRAFT_KEY = 'ph_form_draft_v2'
const DEBOUNCE_MS = 700
const SECADO_OPTIONS = ['', 'X'] as const

const getCurrentYearShort = () => new Date().getFullYear().toString().slice(-2)

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
    observaciones: string
    equipo_horno_codigo: string
    equipo_balanza_001_codigo: string
    equipo_ph_metro_codigo: string
    revisado_por: string
    revisado_fecha: string
    aprobado_por: string
    aprobado_fecha: string
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
    observaciones: '',
    equipo_horno_codigo: '',
    equipo_balanza_001_codigo: '',
    equipo_ph_metro_codigo: '',
    revisado_por: '',
    revisado_fecha: '',
    aprobado_por: '',
    aprobado_fecha: '',
})

const hydrateForm = (payload?: Partial<PhPayload>): FormState => {
    const base = initialState()
    if (!payload) return base

    return {
        ...base,
        ...payload,
        condicion_secado_aire: payload.condicion_secado_aire ?? base.condicion_secado_aire,
        condicion_secado_horno: payload.condicion_secado_horno ?? base.condicion_secado_horno,
        temperatura_ensayo_c: payload.temperatura_ensayo_c ?? base.temperatura_ensayo_c,
        ph_resultado: payload.ph_resultado ?? base.ph_resultado,
        observaciones: payload.observaciones ?? base.observaciones,
        equipo_horno_codigo: payload.equipo_horno_codigo ?? base.equipo_horno_codigo,
        equipo_balanza_001_codigo: payload.equipo_balanza_001_codigo ?? base.equipo_balanza_001_codigo,
        equipo_ph_metro_codigo: payload.equipo_ph_metro_codigo ?? base.equipo_ph_metro_codigo,
        revisado_por: payload.revisado_por ?? base.revisado_por,
        revisado_fecha: payload.revisado_fecha ?? base.revisado_fecha,
        aprobado_por: payload.aprobado_por ?? base.aprobado_por,
        aprobado_fecha: payload.aprobado_fecha ?? base.aprobado_fecha,
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

    const clearAll = useCallback(() => {
        if (!window.confirm('Se limpiaran los datos no guardados. Deseas continuar?')) return
        localStorage.removeItem(`${DRAFT_KEY}:${ensayoId ?? 'new'}`)
        setForm(initialState())
    }, [ensayoId])
    const [pendingFormatAction, setPendingFormatAction] = useState<boolean | null>(null)


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
                }

                if (download) {
                    const downloadResult = await saveAndDownload(payload, ensayoId ?? undefined)
                    const blob = downloadResult instanceof Blob ? downloadResult : downloadResult.blob
                    const filename = downloadResult instanceof Blob ? undefined : downloadResult.filename
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = filename || `${buildFormatPreview(form.muestra, 'SU', 'PH')}.xlsx`
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
        ],
    )

    const denseInputClass =
        'h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm transition focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/35'

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
                        <div className="mx-auto mb-5 w-full max-w-[340px] overflow-hidden rounded-lg border border-slate-300">
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

                        <div className="mx-auto mb-6 w-full max-w-[530px] overflow-hidden rounded-lg border border-slate-300">
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

                        <div className="mx-auto mb-5 w-full max-w-[760px] rounded-lg border border-slate-300 bg-white p-3">
                            <div className="mb-2 text-xs font-semibold text-slate-800">Observaciones:</div>
                            <textarea
                                className="w-full resize-none rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 shadow-sm transition focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500/35"
                                rows={2}
                                value={form.observaciones}
                                onChange={(e) => setField('observaciones', e.target.value)}
                                autoComplete="off"
                                data-lpignore="true"
                            />
                        </div>

                        <div className="mx-auto mb-5 w-full max-w-[430px] overflow-hidden rounded-lg border border-slate-300">
                            <table className="w-full table-fixed text-sm">
                                <thead className="bg-slate-100 text-xs font-semibold text-slate-800">
                                    <tr>
                                        <th className="border-b border-r border-slate-300 py-1">Equipo utilizado</th>
                                        <th className="border-b border-slate-300 py-1">Código</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        { label: 'Horno', key: 'equipo_horno_codigo' as const },
                                        { label: 'Balanza 0.01', key: 'equipo_balanza_001_codigo' as const },
                                        { label: 'PH-Metro', key: 'equipo_ph_metro_codigo' as const },
                                    ].map((row) => (
                                        <tr key={row.key}>
                                            <td className="border-t border-r border-slate-300 px-2 py-1 text-xs">{row.label}</td>
                                            <td className="border-t border-slate-300 p-1">
                                                <input
                                                    className={denseInputClass}
                                                    value={form[row.key]}
                                                    onChange={(e) => setField(row.key, e.target.value)}
                                                    autoComplete="off"
                                                    data-lpignore="true"
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="mx-auto mt-6 grid max-w-[760px] grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="rounded-lg border border-slate-300 bg-white p-3">
                                <div className="mb-3 text-xl leading-none text-slate-900">Revisado:</div>
                                <input
                                    className={denseInputClass}
                                    value={form.revisado_por}
                                    onChange={(e) => setField('revisado_por', e.target.value)}
                                    autoComplete="off"
                                    data-lpignore="true"
                                />
                                <div className="mb-3 mt-4 text-xl leading-none text-slate-900">Fecha:</div>
                                <input
                                    className={denseInputClass}
                                    value={form.revisado_fecha}
                                    onChange={(e) => setField('revisado_fecha', e.target.value)}
                                    onBlur={() => setField('revisado_fecha', normalizeFlexibleDate(form.revisado_fecha))}
                                    autoComplete="off"
                                    data-lpignore="true"
                                    placeholder="DD/MM/AA"
                                />
                            </div>
                            <div className="rounded-lg border border-slate-300 bg-white p-3">
                                <div className="mb-3 text-xl leading-none text-slate-900">Aprobado:</div>
                                <input
                                    className={denseInputClass}
                                    value={form.aprobado_por}
                                    onChange={(e) => setField('aprobado_por', e.target.value)}
                                    autoComplete="off"
                                    data-lpignore="true"
                                />
                                <div className="mb-3 mt-4 text-xl leading-none text-slate-900">Fecha:</div>
                                <input
                                    className={denseInputClass}
                                    value={form.aprobado_fecha}
                                    onChange={(e) => setField('aprobado_fecha', e.target.value)}
                                    onBlur={() => setField('aprobado_fecha', normalizeFlexibleDate(form.aprobado_fecha))}
                                    autoComplete="off"
                                    data-lpignore="true"
                                    placeholder="DD/MM/AA"
                                />
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
                                onClick={() => setPendingFormatAction(false)}
                                disabled={loading}
                                className="h-11 rounded-lg border border-slate-900 bg-white font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100 disabled:opacity-50"
                            >
                                {loading ? 'Guardando...' : 'Guardar'}
                            </button>
                            <button
                                onClick={() => setPendingFormatAction(true)}
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
            <FormatConfirmModal
                open={pendingFormatAction !== null}
                formatLabel={buildFormatPreview(form.muestra, 'SU', 'PH')}
                actionLabel={pendingFormatAction ? 'Guardar y Descargar' : 'Guardar'}
                onClose={() => setPendingFormatAction(null)}
                onConfirm={() => {
                    if (pendingFormatAction === null) return
                    const shouldDownload = pendingFormatAction
                    setPendingFormatAction(null)
                    void save(shouldDownload)
                }}
            />

        </div>
    )
}
