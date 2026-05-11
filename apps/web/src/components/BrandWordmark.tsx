type Props = {
  className?: string;
};

export function BrandWordmark({ className }: Props) {
  return (
    <span className={className}>
      <span className="brand-a">A</span>
      <span>MESH</span>
    </span>
  );
}
