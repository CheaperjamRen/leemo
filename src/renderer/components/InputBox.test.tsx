import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InputBox from "./InputBox";

/**
 * Locks the IME composition gate that jsdom's userEvent {Enter} cannot exercise.
 * Real full-width (中文/日文) input fires compositionStart before the user has
 * committed characters; Enter during that window selects a candidate and MUST NOT
 * submit the message. Only after compositionEnd does Enter send. This is the
 * intended behavior in InputBox (`onKeyDown` guards on `!composing`); the test
 * pins it so a className-only dressing pass can't silently regress the logic.
 */
describe("InputBox IME composition gate", () => {
  function renderInput(value: string) {
    const onSend = vi.fn();
    const onChange = vi.fn();
    render(<InputBox value={value} onChange={onChange} onSend={onSend} />);
    return { onSend, onChange, input: screen.getByPlaceholderText("跟 momo 说点什么…") };
  }

  it("Enter during composition does NOT submit", () => {
    const { onSend, input } = renderInput("在吗");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter after compositionEnd submits the committed text", () => {
    const { onSend, onChange, input } = renderInput("在吗");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" }); // candidate selection — swallowed
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" }); // real submit
    expect(onSend).toHaveBeenCalledExactlyOnceWith("在吗");
    expect(onChange).toHaveBeenLastCalledWith(""); // draft cleared after send
  });
});

describe("InputBox busy/stop", () => {
  it("shows a stop button when busy and calls onStop", () => {
    const onStop = vi.fn();
    render(<InputBox value="" onChange={() => {}} onSend={() => {}} busy onStop={onStop} />);
    const stop = screen.getByRole("button", { name: "停止" });
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalled();
  });

  it("shows the send button when not busy", () => {
    render(<InputBox value="hi" onChange={() => {}} onSend={() => {}} />);
    expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument();
  });

  it("Enter does NOT submit while busy (stop-button design, no overlapping send)", () => {
    const onSend = vi.fn();
    render(<InputBox value="hi" onChange={() => {}} onSend={onSend} busy onStop={() => {}} />);
    fireEvent.keyDown(screen.getByPlaceholderText("跟 momo 说点什么…"), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});
