import Link from 'next/link';

const whatsappUrl = 'https://wa.me/918897536435?text=Hi%20Webgenixx%2C%20I%27d%20like%20to%20discuss%20a%20project.';

type WhatsAppButtonProps = {
  className?: string;
  label?: string;
};

export default function WhatsAppButton({
  className = 'reference-whatsapp-button',
  label = 'Contact us on WhatsApp',
}: WhatsAppButtonProps) {
  return (
    <Link className={className} href={whatsappUrl} target="_blank" rel="noreferrer">
      {label} <span>↗</span>
    </Link>
  );
}
