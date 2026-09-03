"use client";
import { useEffect, useState } from "react";
import { clearApiKey, getApiKey, maskApiKey, pareceKeyValida, setApiKey } from "@/lib/apikey";
import { testConexion } from "@/lib/gemini";

export default function ApiKeyConfig({ onChange }: { onChange?: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState("");
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const k = getApiKey();
    setSaved(k);
    setInput(k);
  }, []);

  const guardar = () => {
    const val = input.trim();
    if (!val) return;
    if (!pareceKeyValida(val) && !confirm("La key no empieza con 'AIza'. ¿Guardar igual?")) return;
    setApiKey(val);
    setSaved(val);
    setMsg(null);
    onChange?.(val);
  };

  const borrar = () => {
    clearApiKey();
    setSaved("");
    setInput("");
    setMsg(null);
    onChange?.("");
  };

  const probar = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const r = await testConexion(input.trim());
      setMsg(r.ok ? { ok: true, texto: `✅ Conexión OK — ${r.modelo}` } : { ok: false, texto: `❌ ${r.error}` });
    } catch (e) {
      setMsg({ ok: false, texto: `❌ ${(e as Error).message}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-lg border px-3 py-1.5 text-sm transition ${
          saved
            ? "border-emerald-500/40 bg-emerald-50 text-emerald-700"
            : "border-amber-400/40 bg-amber-50 text-amber-700"
        }`}
      >
        ⚙ API Key {saved ? `· ${maskApiKey(saved)}` : "· sin configurar"}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <h3 className="mb-1 font-semibold text-slate-800">Gemini API Key</h3>
          <p className="mb-3 text-xs text-slate-500">
            Tu key personal para consumir Gemini. Se guarda solo en este navegador.
            Consíguela en <strong>aistudio.google.com</strong>.
          </p>
          <input
            type="password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 outline-none"
            placeholder="AIza..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && guardar()}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={guardar} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white">
              Guardar
            </button>
            <button
              onClick={probar}
              disabled={testing || !input.trim()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40"
            >
              {testing ? "Probando…" : "🔌 Probar"}
            </button>
            {saved && (
              <button onClick={borrar} className="rounded-lg px-3 py-1.5 text-sm text-red-500">
                Borrar
              </button>
            )}
          </div>
          {msg && (
            <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.texto}</p>
          )}
        </div>
      )}
    </div>
  );
}
