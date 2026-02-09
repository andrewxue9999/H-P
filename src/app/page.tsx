"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseConfigError } from "@/lib/supabaseClient";

type Status = "connecting" | "connected" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("connecting");
  const [detail, setDetail] = useState("Checking Supabase connection...");

  useEffect(() => {
    let active = true;

    const check = async () => {
      if (!supabase) {
        setStatus("error");
        setDetail(supabaseConfigError);
        return;
      }

      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) throw error;

        setStatus("connected");
        setDetail(data.session ? "Session found" : "No session yet");
      } catch (err) {
        if (!active) return;
        setStatus("error");
        setDetail(err instanceof Error ? err.message : "Unknown error");
      }
    };

    check();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Supabase Connected</h1>
        <p className="mt-2 text-sm text-gray-600">
          Status: <span className="font-medium">{status}</span>
        </p>
        <p className="mt-1 text-xs text-gray-500">{detail}</p>
        <a
          className="mt-6 inline-flex rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          href="/term-types"
        >
          View Term Types
        </a>
      </div>
    </main>
  );
}
