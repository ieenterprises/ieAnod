export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-glyph ${small ? 'brand-glyph-small' : ''}`} aria-hidden="true">
      <img
        src="/ieanod-logo.png"
        alt=""
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </span>
  );
}
