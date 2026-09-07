import { useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import type { PlaidLinkOnExit, PlaidLinkOnSuccess } from "react-plaid-link";
import { api } from "../api";

interface Props {
  onLinked: () => Promise<void> | void;
  onError: (message: string) => void;
}

interface SessionProps {
  token: string;
  onSuccess: PlaidLinkOnSuccess;
  onExit: PlaidLinkOnExit;
}

/**
 * One Plaid Link session. Mounted only while a link_token is active so every
 * session gets a fresh usePlaidLink instance: the hook keeps reporting
 * `ready` for a handler it has already destroyed once its token is cleared,
 * which makes reusing a single instance across sessions unreliable.
 */
function LinkSession({ token, onSuccess, onExit }: SessionProps) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });
  const opened = useRef(false);

  useEffect(() => {
    if (ready && !opened.current) {
      opened.current = true;
      open();
    }
  }, [ready, open]);

  return null;
}

export function LinkButton({ onLinked, onError }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<"token" | "exchange" | null>(null);

  const onSuccess: PlaidLinkOnSuccess = async (publicToken) => {
    setToken(null);
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
    }
  };

  const onExit: PlaidLinkOnExit = (err) => {
    setToken(null);
    if (err) onError(`${err.error_code}: ${err.display_message ?? err.error_message}`);
  };

  const start = async () => {
    setBusy("token");
    try {
      const { link_token } = await api.createLinkToken();
      setToken(link_token);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const label =
    busy === "token" ? "Preparing Link…" : busy === "exchange" ? "Linking and syncing…" : "Connect a bank account";

  return (
    <>
      <button className="btn btn-primary" onClick={start} disabled={busy !== null || token !== null}>
        {label}
      </button>
      {token && <LinkSession key={token} token={token} onSuccess={onSuccess} onExit={onExit} />}
    </>
  );
}
