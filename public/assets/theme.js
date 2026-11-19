tailwind.config = {
  theme: {
    extend: {
      fontFamily: { sans: ['Sarabun', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        navy: { 50:'#f0f5fb',100:'#dce7f4',200:'#b9cfe8',300:'#8bb0d7',400:'#5a8ac1',500:'#386ca8',600:'#2a558c',700:'#1f4473',800:'#1b3a60',900:'#172f4d',950:'#0e1d31' },
        gold: { 50:'#fbf7e9',100:'#f5ebc4',300:'#e8c96b',400:'#e0b84a',500:'#c9a227',600:'#a8841c',700:'#7f6315' },
      },
      boxShadow: { card: '0 1px 2px rgba(15,23,42,.04), 0 8px 24px -12px rgba(15,23,42,.12)' },
    },
  },
};
