'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ links }: { links: string[][] }) {
  const path = usePathname();
  return (
    <nav className="stack" style={{ gap: 2 }}>
      {links.map(([href, label]) => (
        <Link key={href} href={href} className={`nav ${path === href || path.startsWith(href + '/') ? 'active' : ''}`}>{label}</Link>
      ))}
    </nav>
  );
}
