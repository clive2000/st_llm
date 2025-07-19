/** @typedef {import('chevrotain').CstNode} CstNode */
/** @typedef {import('chevrotain').IRecognitionException} IRecognitionException */

/** @typedef {{[tokenName: string]: (string|string[]|TestableCstNode|TestableCstNode[])}} TestableCstNode */
/** @typedef {{name: string, message: string}} TestableRecognitionException */

// Those tests ar evaluating via puppeteer, the need more time to run and finish
jest.setTimeout(10_000);

describe('MacroParser', () => {
    beforeAll(async () => {
        await page.goto(global.ST_URL);
        await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 0 });
    });

    describe('General Macro', () => {
        // {{user}}
        it('should parse a simple macro', async () => {
            const input = '{{user}}';
            const macroCst = await runParser(input);

            const expectedCst = {
                'Macro.Start': '{{',
                'Macro.Identifier': 'user',
                'Macro.End': '}}',
            };

            expect(macroCst).toEqual(expectedCst);
        });
        // {{  user  }}
        it('should generally handle whitespaces', async () => {
            const input = '{{  user  }}';
            const macroCst = await runParser(input);

            const expectedCst = {
                'Macro.Start': '{{',
                'Macro.Identifier': 'user',
                'Macro.End': '}}',
            };

            expect(macroCst).toEqual(expectedCst);
        });

        describe('Error Cases (General Macro)', () => {
            // {{}}
            it('[Error] should throw an error for empty macro', async () => {
                const input = '{{}}';
                const { macroCst, errors } = await runParserAndGetErrors(input);

                const expectedErrors = [
                    { name: 'MismatchedTokenException', message: 'Expecting token of type --> Macro.Identifier <-- but found --> \'}}\' <--' },
                ];

                expect(macroCst).toBeUndefined();
                expect(errors).toEqual(expectedErrors);
            });
            // {{§!#&blah}}
            it('[Error] should throw an error for invalid identifier', async () => {
                const input = '{{§!#&blah}}';
                const { macroCst, errors } = await runParserAndGetErrors(input);

                const expectedErrors = [
                    { name: 'MismatchedTokenException', message: 'Expecting token of type --> Macro.Identifier <-- but found --> \'!\' <--' },
                ];

                expect(macroCst).toBeUndefined();
                expect(errors).toEqual(expectedErrors);
            });
            // {{user
            it('[Error] should throw an error for incomplete macro', async () => {
                const input = '{{user';
                const { macroCst, errors } = await runParserAndGetErrors(input);

                const expectedErrors = [
                    { name: 'MismatchedTokenException', message: 'Expecting token of type --> Macro.End <-- but found --> \'\' <--' },
                ];

                expect(macroCst).toBeUndefined();
                expect(errors).toEqual(expectedErrors);
            });

            // something{{user}}
            // something{{user}}
            it('[Error] for testing purposes, macros need to start at the beginning of the string', async () => {
                const input = 'something{{user}}';
                const { macroCst, errors } = await runParserAndGetErrors(input);

                const expectedErrors = [
                    { name: 'MismatchedTokenException', message: 'Expecting token of type --> Macro.Start <-- but found --> \'something\' <--' },
                ];

                expect(macroCst).toBeUndefined();
                expect(errors).toEqual(expectedErrors);
            });
        });
    });

    describe('Arguments Handling', () => {
        // {{getvar::myvar}}
        it('should parse macros with double-colon argument', async () => {
            const input = '{{getvar::myvar}}';
            const macroCst = await runParser(input, {
                flattenKeys: ['arguments.argument'],
            });
            expect(macroCst).toEqual({
                'Macro.Start': '{{',
                'Macro.Identifier': 'getvar',
                'arguments': {
                    'separator': '::',
                    'argument': 'myvar',
                },
                'Macro.End': '}}',
            });
        });

        // {{roll:3d20}}
        it('should parse macros with single colon argument', async () => {
            const input = '{{roll:3d20}}';
            const macroCst = await runParser(input, {
                flattenKeys: ['arguments.argument'],
            });
            expect(macroCst).toEqual({
                'Macro.Start': '{{',
                'Macro.Identifier': 'roll',
                'arguments': {
                    'separator': ':',
                    'argument': '3d20',
                },
                'Macro.End': '}}',
            });
        });

        // {{setvar::myvar::value}}
        it('should parse macros with multiple double-colon arguments', async () => {
            const input = '{{setvar::myvar::value}}';
            const macroCst = await runParser(input, {
                flattenKeys: ['arguments.argument'],
                ignoreKeys: ['arguments.Args.DoubleColon'],
            });
            expect(macroCst).toEqual({
                'Macro.Start': '{{',
                'Macro.Identifier': 'setvar',
                'arguments': {
                    'separator': '::',
                    'argument': ['myvar', 'value'],
                },
                'Macro.End': '}}',
            });
        });

        // {{something::  spaced  }}
        it('should strip spaces around arguments', async () => {
            const input = '{{something::  spaced  }}';
            const macroCst = await runParser(input, {
                flattenKeys: ['arguments.argument'],
                ignoreKeys: ['arguments.separator', 'arguments.Args.DoubleColon'],
            });
            expect(macroCst).toEqual({
                'Macro.Start': '{{',
                'Macro.Identifier': 'something',
                'arguments': { 'argument': 'spaced' },
                'Macro.End': '}}',
            });
        });

        // {{something::with:single:colons}}
        it('should treat single colons as part of the argument with double-colon separator', async () => {
            const input = '{{something::with:single:colons}}';
            const macroCst = await runParser(input, {
                flattenKeys: ['arguments.argument'],
                ignoreKeys: ['arguments.Args.DoubleColon'],
            });
            expect(macroCst).toEqual({
                'Macro.Start': '{{',
                'Macro.Identifier': 'something',
                'arguments': {
                    'separator': '::',
                    'argument': 'with:single:colons',
                },
                'Macro.End': '}}',
            });
        });

        // {{legacy:something:else}}
        it('should treat single colons as part of the argument even with colon separator', async () => {
            const input = '{{legacy:something:else}}';
            const macroCst = await runParser(input, {
                flattenKeys: ['arguments.argument'],
                ignoreKeys: ['arguments.separator', 'arguments.Args.Colon'],
            });
            expect(macroCst).toEqual({
                'Macro.Start': '{{',
                'Macro.Identifier': 'legacy',
                'arguments': { 'argument': 'something:else' },
                'Macro.End': '}}',
            });
        });

        describe('Error Cases (Arguments Handling)', () => {
            // {{something::}}
            it('[Error] should throw an error for double-colon without a value', async () => {
                const input = '{{something::}}';
                const { macroCst, errors } = await runParserAndGetErrors(input);

                const expectedErrors = [
                    {
                        name: 'EarlyExitException', message: expect.stringMatching(/^Expecting: expecting at least one iteration which starts with one of these possible Token sequences:/),
                    },
                ];

                expect(macroCst).toBeUndefined();
                expect(errors).toEqual(expectedErrors);
            });
        });

    });

    describe('Nested Macros', () => {
        it('should parse nested macros inside arguments', async () => {
            const input = '{{outer::word {{inner}}}}';
            const macroCst = await runParser(input, {});
            expect(macroCst).toEqual({
                'Macro.Start': '{{',
                'Macro.Identifier': 'outer',
                'arguments': {
                    'argument': {
                        'Identifier': 'word',
                        'macro': {
                            'Macro.Start': '{{',
                            'Macro.Identifier': 'inner',
                            'Macro.End': '}}',
                        },
                    },
                    'separator': '::',
                },
                'Macro.End': '}}',
            });
        });

        it('should parse two nested macros next to each other inside an argument', async () => {
            const input = '{{outer::word {{inner1}}{{inner2}}}}';
            const macroCst = await runParser(input, {});
            expect(macroCst).toEqual({
                'Macro.Start': '{{',
                'Macro.Identifier': 'outer',
                'arguments': {
                    'argument': {
                        'Identifier': 'word',
                        'macro': [
                            {
                                'Macro.Start': '{{',
                                'Macro.Identifier': 'inner1',
                                'Macro.End': '}}',
                            },
                            {
                                'Macro.Start': '{{',
                                'Macro.Identifier': 'inner2',
                                'Macro.End': '}}',
                            },
                        ],
                    },
                    'separator': '::',
                },
                'Macro.End': '}}',
            });
        });

        describe('Error Cases (Nested Macros)', () => {

            it('[Error] should throw when there is a nested macro instead of an identifier', async () => {
                const input = '{{{{macroindentifier}}::value}}';
                const { macroCst, errors } = await runParserAndGetErrors(input);

                expect(macroCst).toBeUndefined();
                expect(errors).toHaveLength(1); // error doesn't really matter. Just don't parse it pls.
            });

            it('[Error] should throw when there is a macro inside an identifier', async () => {
                const input = '{{inside{{macro}}me}}';
                const { macroCst, errors } = await runParserAndGetErrors(input);

                expect(macroCst).toBeUndefined();
                expect(errors).toHaveLength(1); // error doesn't really matter. Just don't parse it pls.
            });

        });
    });
});

/**
 * Runs the input through the MacroParser and returns the result.
 *
 * @param {string} input - The input string to be parsed.
 * @param {Object} [options={}] Optional arguments
 * @param {string[]} [options.flattenKeys=[]] Optional array of dot-separated keys to flatten
 * @param {string[]} [options.ignoreKeys=[]] Optional array of dot-separated keys to ignore
 * @returns {Promise<TestableCstNode>} A promise that resolves to the result of the MacroParser.
 */
async function runParser(input, options = {}) {
    const { cst, errors } = await runParserAndGetErrors(input, options);

    // Make sure that parser errors get correctly marked as errors during testing, even if the resulting structure might work.
    // If we don't test for errors, the test should fail.
    if (errors.length > 0) {
        throw new Error('Parser errors found\n' + errors.map(x => x.message).join('\n'));
    }

    return cst;
}

/**
 * Runs the input through the MacroParser and returns the syntax tree result and any parser errors.
 *
 * Use `runParser` if you don't want to explicitly test against parser errors.
 *
 * @param {string} input - The input string to be parsed.
 * @param {Object} [options={}] Optional arguments
 * @param {string[]} [options.flattenKeys=[]] Optional array of dot-separated keys to flatten
 * @param {string[]} [options.ignoreKeys=[]] Optional array of dot-separated keys to ignore
 * @returns {Promise<{cst: TestableCstNode, errors: TestableRecognitionException[]}>} A promise that resolves to the result of the MacroParser and error list.
 */
async function runParserAndGetErrors(input, options = {}) {
    const result = await page.evaluate(async (input) => {
        /** @type {import('../../public/scripts/macros/MacroParser.js')} */
        const { MacroParser } = await import('./scripts/macros/MacroParser.js');

        const result = MacroParser.test(input);
        return result;
    }, input);

    return { cst: simplifyCstNode(result.cst, input, options), errors: simplifyErrors(result.errors) };
}

/**
 * Simplify the parser syntax tree result into an easily testable format.
 *
 * @param {CstNode} result The result from the parser
 * @param {Object} [options={}] Optional arguments
 * @param {string[]} [options.flattenKeys=[]] Optional array of dot-separated keys to flatten
 * @param {string[]} [options.ignoreKeys=[]] Optional array of dot-separated keys to ignore
 * @returns {TestableCstNode} The testable syntax tree
 */
function simplifyCstNode(cst, input, { flattenKeys = [], ignoreKeys = [] } = {}) {
    /** @returns {TestableCstNode} @param {CstNode} node @param {string[]} path */
    function simplifyNode(node, path = []) {
        if (!node) return node;
        if (Array.isArray(node)) {
            // Single-element arrays are converted to a single string
            if (node.length === 1) {
                return node[0].image || simplifyNode(node[0], path.concat('[]'));
            }
            // For multiple elements, return an array of simplified nodes
            return node.map(child => simplifyNode(child, path.concat('[]')));
        }
        if (node.children) {
            const simplifiedChildren = {};
            for (const key in node.children) {
                function simplifyChildNode(childNode, path) {
                    if (Array.isArray(childNode)) {
                        // Single-element arrays are converted to a single string
                        if (childNode.length === 1) {
                            return simplifyChildNode(childNode[0], path.concat('[]'));
                        }
                        return childNode.map(child => simplifyChildNode(child, path.concat('[]')));
                    }

                    const flattenKey = path.filter(x => x !== '[]').join('.');
                    if (ignoreKeys.includes(flattenKey)) {
                        return null;
                    } else if (flattenKeys.includes(flattenKey)) {
                        const startOffset = childNode.location.startOffset;
                        const endOffset = childNode.location.endOffset;
                        return input.slice(startOffset, endOffset + 1);
                    } else {
                        return simplifyNode(childNode, path);
                    }
                }

                const simplifiedValue = simplifyChildNode(node.children[key], path.concat(key));
                simplifiedValue && (simplifiedChildren[key] = simplifiedValue);
            }
            return simplifiedChildren;
        }
        return node.image;
    }

    return simplifyNode(cst);
}


/**
 * Simplifies a recognition exceptions into an easily testable format.
 *
 * @param {IRecognitionException[]} errors - The error list containing exceptions to be simplified.
 * @return {TestableRecognitionException[]} - The simplified error list
 */
function simplifyErrors(errors) {
    return errors.map(exception => ({
        name: exception.name,
        message: exception.message,
    }));
}
