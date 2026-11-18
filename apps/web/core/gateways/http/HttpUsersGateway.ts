import type { HttpClient, RequestOptions } from "../../http/HttpClient";
import type { UsersGateway } from "../UsersGateway";
import type { TeamUser } from "../../domain/users";

export class HttpUsersGateway implements UsersGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<{ users: TeamUser[] }>("/api/users");
  }

  inviteStaff(email: string, password: string) {
    return this.http.post("/api/users", { email, password, role: "STAFF" });
  }

  remove(id: string, options?: RequestOptions) {
    return this.http.post(`/api/users/${id}/delete`, undefined, options);
  }
}
