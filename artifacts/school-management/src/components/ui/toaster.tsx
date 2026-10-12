import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

/**
 * In-app messages ("Saved", "Couldn't send"). A small dark pill that slides up from the bottom, says its piece
 * and leaves by itself: three seconds for good news, six for a problem so it can be read. Tap or swipe it down
 * to dismiss it sooner. No card, no close button, nothing left sitting over the page.
 */
export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider swipeDirection="down">
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const bad = props.variant === 'destructive';
        return (
          <Toast key={id} duration={bad ? 6000 : 3000} {...props} onClick={() => props.onOpenChange?.(false)}>
            {bad ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
            <div className="min-w-0">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
