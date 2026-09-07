defmodule KfarwellWeb.AppleMusicController do
  @moduledoc "Hands the browser a signed MusicKit developer token."

  use KfarwellWeb, :controller

  def token(conn, _params) do
    case Kfarwell.AppleMusic.token() do
      {:ok, token, expires_at} ->
        conn
        # The token is public by design and lasts months.
        |> put_resp_header("cache-control", "public, max-age=86400")
        |> json(%{token: token, expiresAt: expires_at})

      {:error, reason} ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{error: "unavailable", reason: inspect(reason)})
    end
  end
end
