import React from 'react';

interface VerifiedBadgeProps {
  size?: number;
  className?: string;
  title?: string;
}

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({
  size = 12,
  className = '',
  title = 'Tài khoản đã xác minh',
}) => {
  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center rounded-full bg-meta text-white shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: size * 0.65, height: size * 0.65 }}
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
};

export default VerifiedBadge;
