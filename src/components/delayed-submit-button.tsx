"use client";

import { MouseEvent, useState } from "react";

type DelayedSubmitButtonProps = {
  className: string;
  idleLabel: string;
  pendingLabel: string;
  delayMs?: number;
};

export default function DelayedSubmitButton({
  className,
  idleLabel,
  pendingLabel,
  delayMs = 500,
}: DelayedSubmitButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const form = event.currentTarget.form;
    if (!form) return;

    setIsSubmitting(true);
    window.setTimeout(() => {
      form.requestSubmit();
    }, delayMs);
  }

  return (
    <button
      className={className}
      disabled={isSubmitting}
      onClick={handleClick}
      type="submit"
    >
      {isSubmitting ? pendingLabel : idleLabel}
    </button>
  );
}
