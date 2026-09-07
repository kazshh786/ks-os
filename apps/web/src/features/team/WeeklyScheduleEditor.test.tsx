import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WeeklyScheduleEditor } from './WeeklyScheduleEditor';

it('adds a second shift without replacing the first shift', () => {
  const onChange=vi.fn();
  const first={dayOfWeek:1,enabled:true,startTime:'09:00',endTime:'12:00'};
  render(<WeeklyScheduleEditor value={[first]} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button',{name:'Add Monday shift'}));
  expect(onChange).toHaveBeenCalledWith([first,{dayOfWeek:1,enabled:true,startTime:'14:00',endTime:'18:00'}]);
});
