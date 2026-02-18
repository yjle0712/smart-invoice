import React, { useState } from "react";
import { supabase } from "./lib/supabaseClient";

export default function Auth({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("✅ تم إنشاء الحساب. يمكنك تسجيل الدخول الآن.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuthed();
      }
    } catch (err: any) {
      setMsg("❌ " + (err?.message || "حدث خطأ"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 20, border: "1px solid #ddd", borderRadius: 12 }}>
      <h2 style={{ marginBottom: 10 }}>{mode === "login" ? "تسجيل الدخول" : "إنشاء حساب"}</h2>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
        />

        <button disabled={loading} style={{ padding: 10, borderRadius: 8 }}>
          {loading ? "..." : mode === "login" ? "Login" : "Sign up"}
        </button>
      </form>

      {msg && <p style={{ marginTop: 10 }}>{msg}</p>}

      <p style={{ marginTop: 12 }}>
        {mode === "login" ? "ما عندكش حساب؟ " : "عندك حساب؟ "}
        <button
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          style={{ border: "none", background: "transparent", color: "#2563eb", cursor: "pointer" }}
        >
          {mode === "login" ? "Create one" : "Login"}
        </button>
      </p>
    </div>
  );
}
