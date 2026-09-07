import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import type { PlaidLinkOnSuccess } from "react-plaid-link";
import { api } from "../api";

interface Props {
  onLinked: () => Promise<void> | void;
  onError: (message: string) => void;
}

export function LinkButton({ onLinked, onError }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<"token" | "exchange" | null>(null);
  const [shouldOpen, setShouldOpen] = useState(false);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken) => {
      if (!publicToken) {
        onError("Plaid Link did not return a public_token");
        return;
      }
      setBusy("exchange");
      try {
        await api.exchangePublicToken(publicToken);
        await onLinked();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
        setToken(null);
      }
    },
    [onLinked, onError],
  );

  const { open, ready } = usePlaidLink({
    token,
    onSuccess,
    onExit: (err) => {
      setToken(null);
      setShouldOpen(false);
      if (err) onError(`${err.error_code}: ${err.display_message ?? err.error_message}`);
    },
  });

  useEffect(() => {
    if (shouldOpen && ready && token) {
      setShouldOpen(false);
      open();
    }
  }, [shouldOpen, ready, token, open]);

  const start = async () => {
    setBusy("token");
    try {
      const { link_token } = await api.createLinkToken();
      setToken(link_token);
      setShouldOpen(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const label =
    busy === "token" ? "Preparing Link…" : busy === "exchange" ? "Linking and syncing…" : "Connect a bank account";

  return (
    <button className="btn btn-primary" onClick={start} disabled={busy !== null || shouldOpen}>
      {label}
    </button>
  );
}
