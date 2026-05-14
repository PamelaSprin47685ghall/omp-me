import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Drop-in replacement for Chakra UI's Collapse component.
 * Uses framer-motion for the open/close animation.
 */
export default function Collapse({ in: isOpen, animateOpacity = true, children, ...rest }) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          key="collapse-content"
          initial={{ height: 0, opacity: animateOpacity ? 0 : 1 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: animateOpacity ? 0 : 1 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          style={{ overflow: 'hidden' }}
          {...rest}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
