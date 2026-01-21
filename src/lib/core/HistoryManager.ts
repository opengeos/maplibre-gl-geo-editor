import type { Command, HistoryState } from './types';

/**
 * HistoryManager - Manages undo/redo functionality using the Command Pattern.
 * Maintains two stacks (undo and redo) and provides methods to record,
 * undo, and redo commands.
 */
export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxSize: number;
  private isExecuting: boolean = false;
  private onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;

  /**
   * Create a new HistoryManager.
   * @param maxSize - Maximum number of history entries (default: 50)
   * @param onHistoryChange - Callback when history state changes
   */
  constructor(maxSize: number = 50, onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void) {
    this.maxSize = maxSize;
    this.onHistoryChange = onHistoryChange;
  }

  /**
   * Record a command to the undo stack without executing it.
   * Clears the redo stack since a new action was performed.
   * @param command - The command to record
   */
  record(command: Command): void {
    // Don't record if we're in the middle of an undo/redo operation
    if (this.isExecuting) {
      return;
    }

    this.undoStack.push(command);

    // Enforce max history size
    while (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }

    // Clear redo stack when a new action is performed
    this.redoStack = [];

    this.notifyChange();
  }

  /**
   * Undo the last command.
   * @returns true if undo was successful, false if nothing to undo
   */
  undo(): boolean {
    if (!this.canUndo()) {
      return false;
    }

    const command = this.undoStack.pop()!;

    this.isExecuting = true;
    try {
      command.undo();
    } finally {
      this.isExecuting = false;
    }

    this.redoStack.push(command);
    this.notifyChange();

    return true;
  }

  /**
   * Redo the last undone command.
   * @returns true if redo was successful, false if nothing to redo
   */
  redo(): boolean {
    if (!this.canRedo()) {
      return false;
    }

    const command = this.redoStack.pop()!;

    this.isExecuting = true;
    try {
      command.execute();
    } finally {
      this.isExecuting = false;
    }

    this.undoStack.push(command);
    this.notifyChange();

    return true;
  }

  /**
   * Check if undo is available.
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available.
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Check if currently executing a command (during undo/redo).
   * Used to prevent recursive recording during undo/redo operations.
   */
  isExecutingCommand(): boolean {
    return this.isExecuting;
  }

  /**
   * Get the current history state.
   */
  getState(): HistoryState {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notifyChange();
  }

  /**
   * Get the description of the next undo action.
   */
  getUndoDescription(): string | null {
    if (this.undoStack.length === 0) {
      return null;
    }
    return this.undoStack[this.undoStack.length - 1].description;
  }

  /**
   * Get the description of the next redo action.
   */
  getRedoDescription(): string | null {
    if (this.redoStack.length === 0) {
      return null;
    }
    return this.redoStack[this.redoStack.length - 1].description;
  }

  /**
   * Notify listeners of history state change.
   */
  private notifyChange(): void {
    if (this.onHistoryChange) {
      this.onHistoryChange(this.canUndo(), this.canRedo());
    }
  }
}
