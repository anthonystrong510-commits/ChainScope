import type { ChainId } from '../types/wallet';

interface ChainIconProps {
  chainId: ChainId;
  size?: number;
  className?: string;
}

export function ChainIcon({ chainId, size = 20, className = '' }: ChainIconProps) {
  switch (chainId) {
    case 'ethereum':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#627EEA" fillOpacity="0.16" />
          <path d="M12 4.5L7.4 12.1L12 14.8L16.6 12.1L12 4.5Z" fill="#627EEA" />
          <path d="M12 15.8L7.4 13.1L12 19.5L16.6 13.1L12 15.8Z" fill="#627EEA" fillOpacity="0.75" />
        </svg>
      );
    case 'polygon':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#8247E5" fillOpacity="0.16" />
          <path
            d="M15.6 9.8C15.3 9.6 14.9 9.6 14.6 9.8L12.5 11L11 11.8L8.9 13C8.6 13.2 8.2 13.2 7.9 13L6.3 12C6 11.8 5.8 11.5 5.8 11.1V9.2C5.8 8.8 6 8.5 6.3 8.3L7.9 7.4C8.2 7.2 8.6 7.2 8.9 7.4L10.5 8.3C10.8 8.5 11 8.8 11 9.2V10.4L12.5 9.5V8.3C12.5 7.9 12.3 7.6 12 7.4L8.9 5.6C8.6 5.4 8.2 5.4 7.9 5.6L4.8 7.4C4.5 7.6 4.3 7.9 4.3 8.3V11.9C4.3 12.3 4.5 12.6 4.8 12.8L7.9 14.6C8.2 14.8 8.6 14.8 8.9 14.6L11 13.4L12.5 12.5L14.6 11.3C14.9 11.1 15.3 11.1 15.6 11.3L17.2 12.2C17.5 12.4 17.7 12.7 17.7 13.1V15C17.7 15.4 17.5 15.7 17.2 15.9L15.6 16.8C15.3 17 14.9 17 14.6 16.8L13 15.9C12.7 15.7 12.5 15.4 12.5 15V13.8L11 14.7V15.9C11 16.3 11.2 16.6 11.5 16.8L14.6 18.6C14.9 18.8 15.3 18.8 15.6 18.6L18.7 16.8C19 16.6 19.2 16.3 19.2 15.9V12.3C19.2 11.9 19 11.6 18.7 11.4L15.6 9.8Z"
            fill="#8247E5"
          />
        </svg>
      );
    case 'solana':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#14F195" fillOpacity="0.14" />
          <path d="M7.5 15.5H15.8L17.2 17H8.9L7.5 15.5Z" fill="#14F195" />
          <path d="M7.5 7H15.8L17.2 8.5H8.9L7.5 7Z" fill="#14F195" />
          <path d="M17.2 11.2H8.9L7.5 12.7H15.8L17.2 11.2Z" fill="#00C2FF" />
        </svg>
      );
    case 'arbitrum':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#28A0F0" fillOpacity="0.16" />
          <path d="M12 5L17.5 8.2V15.8L12 19L6.5 15.8V8.2L12 5Z" stroke="#28A0F0" strokeWidth="1.6" />
          <path d="M10 15L12.6 9.5L15 15" stroke="#28A0F0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'base':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#0052FF" fillOpacity="0.16" />
          <path d="M12 6C15.3 6 18 8.7 18 12C18 15.3 15.3 18 12 18C9 18 6.5 15.8 6.1 12.9H13.5V11.1H6.1C6.5 8.2 9 6 12 6Z" fill="#3B82F6" />
        </svg>
      );
    case 'optimism':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#FF0420" fillOpacity="0.15" />
          <circle cx="9.2" cy="12" r="2.8" fill="#FF0420" />
          <rect x="13.2" y="9.2" width="3.8" height="5.6" rx="1.5" fill="#FF0420" />
        </svg>
      );
    case 'bsc':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#F3BA2F" fillOpacity="0.16" />
          <path d="M12 6.5L14.5 9L12 11.5L9.5 9L12 6.5ZM6.5 12L9 9.5L11.5 12L9 14.5L6.5 12ZM12 12.5L14.5 15L12 17.5L9.5 15L12 12.5ZM14.5 9.5L17.5 12L14.5 14.5L12.5 12L14.5 9.5Z" fill="#F3BA2F" />
        </svg>
      );
  }
}
