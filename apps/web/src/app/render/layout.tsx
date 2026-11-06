export default function RenderLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ margin: 0, overflow: 'hidden', background: '#000' }}>{children}</div>;
}
