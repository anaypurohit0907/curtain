package model

import (
	"time"

	"github.com/google/uuid"
)

// User is the canonical user record stored in auth.users.
type User struct {
	ID         uuid.UUID `json:"id"`
	Email      string    `json:"email"`
	Password   string    `json:"-"`         // never serialised
	Provider   string    `json:"provider"`
	ProviderID string    `json:"provider_id,omitempty"`
	Role       string    `json:"role"`
	Metadata   []byte    `json:"metadata"`
	Confirmed  bool      `json:"confirmed"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
