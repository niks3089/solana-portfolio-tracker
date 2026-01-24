import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function build() {
    try {
        await esbuild.build({
            entryPoints: [join(__dirname, '../src/DialectNotifications.jsx')],
            bundle: true,
            outfile: join(__dirname, '../public/js/dialect-notifications.js'),
            format: 'iife',
            globalName: 'DialectNotifications',
            minify: true,
            sourcemap: false,
            target: ['es2020'],
            jsx: 'automatic',
            jsxImportSource: 'react',
            define: {
                'process.env.NODE_ENV': '"production"',
                'global': 'window',
            },
            mainFields: ['browser', 'module', 'main'],
            conditions: ['browser', 'import', 'default'],
            resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'],
            // Ignore sideEffects: false for CSS files
            ignoreAnnotations: true,
            // React 18 handles client separately
            plugins: [
                {
                    name: 'css-loader',
                    setup(build) {
                        build.onLoad({ filter: /\.css$/ }, async (args) => {
                            const fs = await import('fs/promises');
                            const css = await fs.readFile(args.path, 'utf8');
                            return {
                                contents: `
                  (function() {
                    if (typeof document !== 'undefined') {
                      const style = document.createElement('style');
                      style.textContent = ${JSON.stringify(css)};
                      document.head.appendChild(style);
                    }
                  })();
                  export default {};
                `,
                                loader: 'js',
                            };
                        });
                    },
                },
            ],
        });
        console.log('✓ Built dialect-notifications.js');
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();

