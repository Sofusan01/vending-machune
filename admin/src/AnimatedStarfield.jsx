import {memo, useMemo} from 'react';
import {motion} from 'framer-motion';

const colors = ['bg-[#0066CC]', 'bg-[#0A235C]', 'bg-[#69B8FF]', 'bg-[#ffc5a4]'];

export default memo(function AnimatedStarfield({active=true}) {
  const stars = useMemo(() => {
    return Array.from({length: 60}).map((_, i) => ({
      id: i,
      x: Math.random() * 100, // 0 to 100% width
      size: Math.random() * 4 + 2, // 2px to 6px
      duration: Math.random() * 30 + 20, // 20s to 50s (very slow and smooth)
      delay: -(Math.random() * 50), // Negative delay to scatter them instantly
      baseOpacity: Math.random() * 0.4 + 0.1,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));
  }, []);

  if (!active) return null; // Save CPU when screensaver covers the screen

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      {stars.map(star => (
        <motion.div
          key={star.id}
          className={`absolute rounded-full ${star.color}`}
          style={{
            left: `${star.x}%`,
            width: star.size,
            height: star.size,
          }}
          initial={{ y: '110vh', opacity: star.baseOpacity }}
          animate={{
            y: ['110vh', '-10vh'],
            opacity: [star.baseOpacity, star.baseOpacity + 0.4, star.baseOpacity]
          }}
          transition={{
            y: {
              duration: star.duration,
              repeat: Infinity,
              ease: "linear",
              delay: star.delay
            },
            opacity: {
              duration: star.duration / 4,
              repeat: Infinity,
              ease: "easeInOut",
              delay: star.delay
            }
          }}
        />
      ))}
    </div>
  );
});
