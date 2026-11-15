import Footer from '../components/footer';
import Navbar from '../components/navbar';
import BrandLoopBanner from './sections/brand-loop-banner';
import CustomRequirementForm from './sections/custom-requirement-form';
import Hero from './sections/hero';
import HowWeWork from './sections/how-we-work';
import LoopBanner from './sections/loop-banner';
import OurCapabilities from './sections/our-capabilities';
import WeAreWebgenixx from './sections/we-are-webgenixx';

export default function WebgenixxHome() {
  return (
    <main className="reference-home">
      <Navbar />

      <Hero />
      <LoopBanner />
      <WeAreWebgenixx />
      <OurCapabilities />
      <HowWeWork />
      <CustomRequirementForm />
      <BrandLoopBanner />

      <Footer />
    </main>
  );
}
