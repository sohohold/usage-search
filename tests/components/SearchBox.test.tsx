// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchBox from '@/components/SearchBox';

function setup(props: Partial<React.ComponentProps<typeof SearchBox>> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  render(
    <SearchBox value="" onChange={onChange} onSubmit={onSubmit} isLoading={false} {...props} />
  );
  return {
    onChange,
    onSubmit,
    input: screen.getByRole('textbox'),
    button: screen.getByRole('button', { name: '検索' }),
    user: userEvent.setup(),
  };
}

describe('SearchBox', () => {
  it('UI-01: マウント直後に入力欄へフォーカスする', () => {
    const { input } = setup();
    expect(input).toHaveFocus();
  });

  it('UI-02: 入力値を onChange で伝える', async () => {
    const { user, input, onChange } = setup();
    await user.type(input, '月');
    expect(onChange).toHaveBeenCalledWith('月');
  });

  it('UI-03: Enter で onSubmit を1回呼ぶ', async () => {
    const { user, input, onSubmit } = setup({ value: '月が綺麗' });
    await user.type(input, '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('UI-04: Enter 以外のキーでは onSubmit を呼ばない', async () => {
    const { user, input, onSubmit } = setup({ value: '月が綺麗' });
    await user.type(input, 'a{Escape}{ArrowDown}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('UI-05: 検索ボタンのクリックで onSubmit を1回呼ぶ', async () => {
    const { user, button, onSubmit } = setup({ value: '月が綺麗' });
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('UI-06: 3文字未満ではボタンを押せない', () => {
    expect(setup({ value: 'ab' }).button).toBeDisabled();
  });

  it('UI-07: 空白のみは trim 判定で押せない', () => {
    expect(setup({ value: '     ' }).button).toBeDisabled();
  });

  it('UI-08: ローディング中はボタンを押せず、スピナーを出す', () => {
    const { button } = setup({ value: '月が綺麗', isLoading: true });
    expect(button).toBeDisabled();
    expect(document.body.querySelector('.animate-spin')).not.toBeNull();
  });

  it('UI-09: ローディング中でなければスピナーを出さない', () => {
    setup({ value: '月が綺麗' });
    expect(document.body.querySelector('.animate-spin')).toBeNull();
  });
});
