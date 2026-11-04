import React from 'react';

const KEYS = [
  { digit: '1', sub: '' },
  { digit: '2', sub: 'A B C' },
  { digit: '3', sub: 'D E F' },
  { digit: '4', sub: 'G H I' },
  { digit: '5', sub: 'J K L' },
  { digit: '6', sub: 'M N O' },
  { digit: '7', sub: 'P Q R S' },
  { digit: '8', sub: 'T U V' },
  { digit: '9', sub: 'W X Y Z' },
  { digit: '*', sub: '' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: '' },
];

export function Keypad({ onDigitPress }) {
  return (
    <div className="grid grid-cols-3 gap-4 max-w-[280px] mx-auto select-none">
      {KEYS.map(({ digit, sub }) => (
        <button
          key={digit}
          type="button"
          onClick={() => onDigitPress(digit)}
          className="w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-slate-800/80 hover:bg-slate-700/80 active:bg-slate-600 text-white flex flex-col items-center justify-center transition-all shadow-md active:scale-95 border border-slate-700/40"
        >
          <span className="text-2xl sm:text-3xl font-medium tracking-tight leading-none">{digit}</span>
          {sub && (
            <span className="text-[9px] font-bold tracking-widest text-slate-400 mt-1 leading-none">
              {sub}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

