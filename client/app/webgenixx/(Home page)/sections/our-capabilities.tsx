import Link from 'next/link';

const capabilities = [
  ['01', 'Web development', 'Modern websites and web applications built for momentum.'],
  ['02', 'Mobile apps', 'Android, iOS, and cross-platform products people enjoy using.'],
  ['03', 'UI/UX design', 'Research, interfaces, and journeys that make sense immediately.'],
  ['04', 'SaaS development', 'Custom software and scalable platforms for ambitious products.'],
  ['05', 'Digital marketing', 'Strategic campaigns, SEO, social media, and performance marketing to grow your brand.'],
];

export default function OurCapabilities() {
  return (
    <section className="reference-capabilities" id="capabilities">
      <div className="reference-label">Our capabilities</div>
      <div className="reference-capability-list">
        {capabilities.map(([number, title, copy]) => (
          <Link className="reference-capability" href="/services" key={number}>
            <span>{number}</span>
            <div><h3>{title}</h3><p>{copy}</p></div>
            <b>↗</b>
          </Link>
        ))}
      </div>
    </section>
  );
}
