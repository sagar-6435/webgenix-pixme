import Footer from '../components/footer';
import Navbar from '../components/navbar';
import WhatsAppButton from '../components/whatsapp-button';

export default function GetStartedPage() {
  return <main className="agency-site">
    <Navbar />
    <section className="agency-contact agency-get-started agency-page-contact">
      <div className="agency-section-label">Get started <span>Let&apos;s build together</span></div>
      <WhatsAppButton className="agency-whatsapp-button" label="Contact us on WhatsApp" />
    </section>
    <section className="agency-process agency-agreement"><div className="agency-section-label">What happens next <span>Simple and clear</span></div><h2>From contact to<br /><em>let&apos;s build.</em></h2><div className="process-grid">{[['01', 'Share', 'Send us a few details about your idea, goals, and timeline.'], ['02', 'Connect', 'We ask useful questions and recommend the right next step.'], ['03', 'Start', 'Once we agree on the plan, we turn the idea into progress.']].map(([number, title, copy]) => <div key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></div>)}</div></section>
    <Footer />
  </main>;
}
