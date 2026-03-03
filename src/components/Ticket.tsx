import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Ticket as TicketIcon, Download, CheckCircle2 } from "lucide-react";

interface TicketProps {
  registrationId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  timestamp: string;
  eventName: string;
  eventLocation: string;
  eventDateLabel: string;
  eventMapUrl?: string;
}

export function Ticket({ 
  registrationId, 
  firstName, 
  lastName, 
  phone, 
  email, 
  timestamp,
  eventName,
  eventLocation,
  eventDateLabel,
  eventMapUrl
}: TicketProps) {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");

  useEffect(() => {
    QRCode.toDataURL(registrationId, { width: 200, margin: 2 }, (err, url) => {
      if (!err) setQrCodeUrl(url);
    });
  }, [registrationId]);

  return (
    <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl overflow-hidden shadow-xl max-w-sm mx-auto my-4">
      <div className="bg-blue-600 p-6 text-white text-center relative">
        <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-slate-50 rounded-full" />
        <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-slate-50 rounded-full" />
        
        <TicketIcon className="w-10 h-10 mx-auto mb-2 opacity-80" />
        <h3 className="text-xl font-bold tracking-tight uppercase">{eventName}</h3>
        <p className="text-blue-100 text-[10px] uppercase tracking-widest font-semibold">Official Registration Pass</p>
      </div>
      
      <div className="p-6 space-y-4">
        <div className="flex justify-center">
          {qrCodeUrl ? (
            <img src={qrCodeUrl} alt="QR Code" className="w-40 h-40 border-4 border-slate-50 rounded-xl" />
          ) : (
            <div className="w-40 h-40 bg-slate-100 animate-pulse rounded-xl" />
          )}
        </div>
        
        <div className="space-y-3">
          <div className="flex justify-between items-end border-b border-slate-100 pb-2">
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Attendee</p>
              <p className="font-semibold text-slate-800">{firstName} {lastName}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">ID Number</p>
              <p className="font-mono font-bold text-blue-600">{registrationId}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Location</p>
              <p className="text-slate-600 text-xs leading-tight">{eventLocation}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Event Window</p>
              <p className="text-slate-600 text-xs leading-tight">{eventDateLabel || "-"}</p>
            </div>
          </div>
        </div>

        {email && (
          <div className="pt-2 border-t border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Email</p>
            <p className="text-slate-600 text-xs">{email}</p>
          </div>
        )}

        {eventMapUrl && (
          <a 
            href={eventMapUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
          >
            <Download className="w-3 h-3 rotate-180" />
            View on Google Maps
          </a>
        )}
      </div>
      
      <div className="bg-slate-50 p-4 border-t border-slate-100 flex items-center justify-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-widest">
        <CheckCircle2 className="w-4 h-4" />
        Verified Registration
      </div>
    </div>
  );
}
