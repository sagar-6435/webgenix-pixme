import Link from 'next/link';
import Footer from '../webgenixx/components/footer';
import Navbar from '../webgenixx/components/navbar';

const websitePlans = [
  { number: '01', title: 'Service-Based Website', price: '₹5,000', features: ['Basic UI/UX', '5 Pages (Home, About, Services, Testimonials, Contact)', 'Social Media Integration'], note: 'Additional Page: ₹1,000' },
  { number: '02', title: 'Product-Based Website', price: '₹7,000', features: ['Up to 50 Products', 'WhatsApp Cart', 'Basic UI/UX', '5 Core Pages', 'Social Media Integration'], note: 'Additional 50 Products: ₹1,000' },
  { number: '03', title: 'Semi E-Commerce', price: '₹15,000', features: ['Dynamic Website', 'WhatsApp Integration', 'Admin Panel', 'Product Management', 'Promo Codes', '5 Core Pages'] },
  { number: '04', title: 'Full E-Commerce', price: '₹25,000', features: ['Razorpay Payment Gateway', 'Admin Panel', 'Customer Google Login', 'Order Management', 'Responsive Design'], note: 'Add-ons: Invoice Printing, Custom UI/UX, Delivery Integration, OTP Login, WhatsApp Alerts' },
];

const maintenancePlans = [
  { number: '01', title: 'Care Basic', price: '₹1,500', features: ['Monthly Backups', '2 Content Updates', 'Uptime Monitoring', 'Security Checks'] },
  { number: '02', title: 'Care Pro', price: '₹3,500', features: ['Weekly Backups', '8 Content Updates', 'Plugin Updates', 'Performance Optimization', 'Priority Support'] },
  { number: '03', title: 'Care E-Commerce', price: '₹6,500', features: ['Daily Backups', 'Unlimited Minor Updates', 'Payment Gateway Monitoring', 'Bug Fixes', 'Monthly Reports'] },
];

const whatsappNumber = '918897536435';

function getPlanWhatsAppUrl(plan: string) {
  const message = `Hi Webgenixx, I would like to choose the ${plan} plan.`;
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

export default function ServicesPage() {
  return <main className="reference-home agency-site">
    <Navbar />
    <header className="agency-services-heading"><div className="agency-section-label">Services &amp; Pricing <span>Transparent packages</span></div></header>
    <section className="agency-pricing" aria-label="Services and pricing">
      <div className="pricing-category"><div className="pricing-category-heading"><span>01</span><h3>Website Development</h3><p>Launch a polished digital presence or a complete online store.</p></div><div className="pricing-grid">{websitePlans.map((plan) => <article className={`pricing-card ${plan.number === '04' ? 'pricing-card-featured' : ''}`} key={plan.number}><span className="pricing-number">{plan.number}</span><h4>{plan.title}</h4><div className="pricing-price">{plan.price}</div><ul>{plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>{plan.note && <p className="pricing-note">{plan.note}</p>}<a href={getPlanWhatsAppUrl(`Website Development - ${plan.title}`)} target="_blank" rel="noreferrer">Choose this plan <b>↗</b></a></article>)}</div></div>
      <div className="pricing-category"><div className="pricing-category-heading"><span>02</span><h3>Website Maintenance</h3><p>Keep your website secure, current, and performing at its best.</p></div><div className="pricing-grid pricing-grid-three">{maintenancePlans.map((plan) => <article className="pricing-card" key={plan.number}><span className="pricing-number">{plan.number}</span><h4>{plan.title}</h4><div className="pricing-price">{plan.price}<small>/ month</small></div><ul>{plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul><a href={getPlanWhatsAppUrl(`Website Maintenance - ${plan.title}`)} target="_blank" rel="noreferrer">Choose this plan <b>↗</b></a></article>)}</div></div>
      <div className="pricing-row-two">
        <div className="pricing-category pricing-mobile"><div className="pricing-category-heading"><span>03</span><h3>Mobile App Development</h3><p>From MVP to production-ready apps, we scope the right solution around your requirements.</p></div><article className="pricing-card pricing-custom"><div><h4>Built around your requirements</h4><div className="pricing-price">Let&apos;s talk</div><p>Every app is different. We&apos;ll shape the features, platforms, timeline, and investment with you.</p></div><a href={getPlanWhatsAppUrl('Mobile App Development')} target="_blank" rel="noreferrer">Discuss your app <b>↗</b></a></article></div>
        <div className="pricing-category pricing-mobile"><div className="pricing-category-heading"><span>04</span><h3>Digital Marketing</h3><p>From brand awareness to performance campaigns, we build marketing strategies tailored to your goals.</p></div><article className="pricing-card pricing-custom"><div><h4>Built around your requirements</h4><div className="pricing-price">Let&apos;s talk</div><p>Every business is unique. We&apos;ll shape the strategy, channels, timeline, and budget with you.</p></div><a href={getPlanWhatsAppUrl('Digital Marketing')} target="_blank" rel="noreferrer">Discuss your marketing <b>↗</b></a></article></div>
      </div>
    </section>
    <section className="agency-contact agency-get-started"><div className="agency-section-label">Have a question?</div><h2>Need a plan<br /><em>that fits?</em></h2><Link className="agency-button agency-button-light" href="/get-started">Talk to Webgenixx <span>↗</span></Link></section>
    <Footer />
  </main>;
}
