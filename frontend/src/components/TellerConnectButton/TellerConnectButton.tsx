import { useTellerConnect, type TellerConnectOnSuccess } from 'teller-connect-react';

interface TellerConnectButtonProps {
  applicationId: string;
  environment: 'sandbox' | 'development' | 'production';
  onSuccess: (accessToken: string, enrollmentId: string, institutionName: string) => Promise<void>;
  disabled?: boolean;
}

export function TellerConnectButton({
  applicationId,
  environment,
  onSuccess,
  disabled = false,
}: TellerConnectButtonProps) {
  const handleSuccess: TellerConnectOnSuccess = (enrollment) => {
    void onSuccess(
      enrollment.accessToken,
      enrollment.enrollment.id,
      enrollment.enrollment.institution.name,
    );
  };

  const { open, ready } = useTellerConnect({
    applicationId,
    environment,
    products: ['transactions'],
    onSuccess: handleSuccess,
  });

  return (
    <button
      type="button"
      onClick={() => open()}
      disabled={disabled || !ready}
      style={{
        padding: '0.5rem 1rem',
        borderRadius: '6px',
        background: '#1a56db',
        color: '#fff',
        border: 'none',
        cursor: disabled || !ready ? 'not-allowed' : 'pointer',
        opacity: disabled || !ready ? 0.6 : 1,
        fontSize: '0.875rem',
        fontWeight: 500,
      }}
    >
      + Connect with Teller
    </button>
  );
}
