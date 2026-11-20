
  const OMR = { SP, prepare, analyze, recognize, toText, components, inkIn, findVLines, halfRuns, erodeDisk };
  if (typeof module !== 'undefined' && module.exports) module.exports = OMR;
  else root.OMR = OMR;
})(typeof self !== 'undefined' ? self : this);
