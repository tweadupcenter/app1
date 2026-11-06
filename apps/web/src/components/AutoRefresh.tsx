'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
/** Rafraîchit la page tant qu'un traitement est en cours (statut réel lu en base). */
export function AutoRefresh({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => router.refresh(), seconds * 1000); return () => clearInterval(t); }, [router, seconds]);
  return null;
}
