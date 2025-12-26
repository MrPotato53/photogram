import { useState, useEffect } from 'react';
import { Modal, Button, Input } from '../common';

interface RenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRename: (newName: string) => void;
  currentName: string;
  existingNames: string[];
}

export function RenameModal({ isOpen, onClose, onRename, currentName, existingNames }: RenameModalProps) {
  const [name, setName] = useState(currentName);

  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  const trimmedName = name.trim();
  const isDuplicate = existingNames.some(
    (n) => n.toLowerCase() === trimmedName.toLowerCase() && n.toLowerCase() !== currentName.toLowerCase()
  );
  const isValid = trimmedName.length > 0 && !isDuplicate;
  const hasChanged = trimmedName !== currentName;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid && hasChanged) {
      onRename(trimmedName);
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Rename Project" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Input
            label="Project Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onFocus={(e) => e.target.select()}
          />
          {isDuplicate && (
            <p className="mt-1 text-xs text-red-500">A project with this name already exists</p>
          )}
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isValid || !hasChanged}>
            Rename
          </Button>
        </div>
      </form>
    </Modal>
  );
}
