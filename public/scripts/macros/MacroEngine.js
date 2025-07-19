import { MacroLexer } from './MacroLexer.js';
import { MacroParser } from './MacroParser.js';

class MacroEngine {
    static instance = new MacroEngine();

    constructor() {
        this.parser = MacroParser;
    }

    /**
     * Parse the input document and return the evaluated content.
     * @param {string} input Input document to evaluate
     * @param {import('../macros.js').Macro[]} macros Array of macros to evaluate
     * @returns {string} The evaluated content
     */
    parseDocument(input, macros) {
        const lexingResult = MacroLexer.tokenize(input);
        this.parser.input = lexingResult.tokens;
        const cst = this.parser.document();

        // Check for parsing errors
        if (this.parser.errors.length > 0) {
            console.warn('MacroEngine parsing errors:', this.parser.errors);
            // Return original input if parsing fails
            return input;
        }

        // Create a visitor to traverse the CST and evaluate macros
        const BaseCstVisitor = this.parser.getBaseCstVisitorConstructor();

        class MacroEvaluatorVisitor extends BaseCstVisitor {
            constructor() {
                super();
                this.validateVisitor();
            }

            document(ctx) {
                // Collect all nodes with their positions
                const nodes = [];

                if (ctx.Plaintext) {
                    for (const textNode of ctx.Plaintext) {
                        nodes.push({
                            startOffset: textNode.startOffset,
                            content: textNode.image,
                            type: 'plaintext',
                        });
                    }
                }

                if (ctx.macro) {
                    for (const macroNode of ctx.macro) {
                        const macroResult = this.visit(macroNode);
                        nodes.push({
                            startOffset: macroNode.location.startOffset,
                            content: macroResult,
                            type: 'macro',
                        });
                    }
                }

                // Sort by position and collect content
                nodes.sort((a, b) => a.startOffset - b.startOffset);
                return nodes.map(node => node.content).join('');
            }

            macro(ctx) {
                const identifier = ctx['Macro.Identifier'][0].image;
                const args = ctx.arguments ? this.visit(ctx.arguments) : [];

                // Find matching macro by name
                const matchingMacro = macros.find(macro => {
                    if (Array.isArray(macro.name)) {
                        return macro.name.includes(identifier);
                    }
                    return macro.name === identifier;
                });

                if (matchingMacro) {
                    try {
                        // Calculate the offset of the macro in the original document
                        const macroStartOffset = ctx['Macro.Start'][0].startOffset;

                        // Create MacroReplaceArgs object
                        const macroArgs = {
                            args: args,
                            offset: macroStartOffset,
                            document: input,
                        };

                        const result = matchingMacro.replace(macroArgs);
                        return String(result);
                    } catch (error) {
                        console.warn(`Error evaluating macro "${identifier}":`, error);
                        // Return the original macro text if evaluation fails
                        return `{{${identifier}${args.length > 0 ? '::' + args.join('::') : ''}}}`;
                    }
                }

                // If no matching macro found, return the original macro text
                return `{{${identifier}${args.length > 0 ? '::' + args.join('::') : ''}}}`;
            }

            arguments(ctx) {
                const args = [];

                if (ctx.argument) {
                    for (const arg of ctx.argument) {
                        const argValue = this.visit(arg);
                        args.push(argValue);
                    }
                }

                return args;
            }

            argument(ctx) {
                const parts = [];

                // Handle nested macros within arguments
                if (ctx.macro) {
                    for (const nestedMacro of ctx.macro) {
                        parts.push(this.visit(nestedMacro));
                    }
                }

                // Handle identifier tokens
                if (ctx.Identifier) {
                    for (const identifier of ctx.Identifier) {
                        parts.push(identifier.image);
                    }
                }

                // Handle unknown characters
                if (ctx.Unknown) {
                    for (const unknown of ctx.Unknown) {
                        parts.push(unknown.image);
                    }
                }

                // Handle colons within arguments
                if (ctx['Args.Colon']) {
                    for (const colon of ctx['Args.Colon']) {
                        parts.push(colon.image);
                    }
                }

                return parts.join('').trim();
            }
        }

        const visitor = new MacroEvaluatorVisitor();
        const result = visitor.visit(cst);

        return result || input;
    }
}

const macroEngineInstance = MacroEngine.instance;

export { MacroEngine, macroEngineInstance };
