import type { Command, HistoryOperationType } from '../types';

/**
 * Command that groups multiple sub-commands together.
 * Useful for composite operations like union, difference, split.
 * Undo: undoes all sub-commands in reverse order.
 * Execute/Redo: executes all sub-commands in order.
 */
export class CompositeCommand implements Command {
  readonly description: string;
  readonly type: HistoryOperationType = 'composite';

  private commands: Command[];

  /**
   * Create a new CompositeCommand.
   * @param commands - The sub-commands to group together
   * @param description - Description of the composite operation
   */
  constructor(commands: Command[], description: string) {
    this.commands = commands;
    this.description = description;
  }

  /**
   * Execute/redo all sub-commands in order.
   */
  execute(): void {
    for (const command of this.commands) {
      command.execute();
    }
  }

  /**
   * Undo all sub-commands in reverse order.
   */
  undo(): void {
    // Undo in reverse order
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }

  /**
   * Get the number of sub-commands.
   */
  getCommandCount(): number {
    return this.commands.length;
  }
}
