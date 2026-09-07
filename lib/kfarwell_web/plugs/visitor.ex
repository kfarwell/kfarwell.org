defmodule KfarwellWeb.Plugs.Visitor do
  @moduledoc """
  Gives every browser an opaque id, stored in the session cookie.

  It is the only thing tying a person to their chat thread, so it is random
  and never derived from anything about them.
  """

  import Plug.Conn

  @key "visitor_id"

  def init(opts), do: opts

  def call(conn, _opts) do
    case get_session(conn, @key) do
      nil -> put_session(conn, @key, generate())
      _id -> conn
    end
  end

  @doc "Reads the visitor id out of a LiveView session map."
  @spec from_session(map()) :: String.t()
  def from_session(session), do: Map.get(session, @key) || generate()

  # Base32, so the id cannot contain the underscore that separates it from the
  # nickname in a thread name.
  defp generate do
    10 |> :crypto.strong_rand_bytes() |> Base.encode32(case: :lower, padding: false)
  end
end
