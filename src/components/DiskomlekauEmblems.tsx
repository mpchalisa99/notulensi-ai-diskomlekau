import React, { useState } from 'react';

export function WingCrestEmblem({ className = 'w-12 h-12' }: { className?: string }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="flex flex-col items-center shrink-0">
      <div
        className={`relative rounded-full overflow-hidden bg-black border border-amber-500/60 shadow-md flex items-center justify-center ${className}`}
      >
        {!imgError ? (
          <img
            src="/assets/aistudio/1792503945296_954409ac.jpg"
            alt="Logo TNI Angkatan Udara - Swa Bhuwana Paksa"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover scale-[1.06]"
          />
        ) : (
          <span className="text-[9px] font-bold text-amber-400 text-center leading-tight px-1">
            TNI AU
          </span>
        )}
      </div>
      <span className="text-[9px] font-bold tracking-wider text-amber-400/90 mt-0.5 leading-none">
        TNI AU
      </span>
    </div>
  );
}

export function KomlekOmegaEmblem({ className = 'w-12 h-12' }: { className?: string }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="flex flex-col items-center shrink-0">
      <div
        className={`relative rounded-full overflow-hidden bg-[#002952] border border-amber-500/60 shadow-md flex items-center justify-center ${className}`}
      >
        {!imgError ? (
          <img
            src="/assets/aistudio/1794622160588_bf320b0e.png"
            alt="Logo Petir Diskomlekau"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover scale-[1.09]"
          />
        ) : (
          <span className="text-[9px] font-bold text-amber-400 text-center leading-tight px-1">
            KOMLEK
          </span>
        )}
      </div>
    </div>
  );
}
