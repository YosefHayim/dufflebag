/**
 * Conservative SVGO config for composed animated SVGs.
 * Preserves animation hooks, styles, gradients, and opacity-0 rest frames.
 */
export default {
  multipass: true,
  js2svg: { pretty: false },
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,
          cleanupIds: false,
          collapseGroups: false,
          inlineStyles: false,
          minifyStyles: false,
          mergePaths: false,
          removeHiddenElems: false,
          convertPathData: { floatPrecision: 2 },
        },
      },
    },
  ],
};
