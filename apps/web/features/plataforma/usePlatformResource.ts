"use client";

import { useEffect, useState } from "react";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePlatform } from "./PlatformShell";

export function usePlatformResource<T>(load: () => Promise<HttpResult<T>>) {
  const { request } = usePlatform();
  const [state, setState] = useState<{ load: () => Promise<HttpResult<T>>; result: HttpResult<T> } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let mounted = true;
    request(load).then((result) => { if (mounted) setState({ load, result }); });
    return () => { mounted = false; };
  }, [load, request, revision]);
  const result = state?.load === load ? state.result : null;
  return {
    data: result?.ok ? result.data : null,
    error: result && !result.ok ? result.error : null,
    loading: result === null,
    reload: () => { setState(null); setRevision((value) => value + 1); },
  };
}
